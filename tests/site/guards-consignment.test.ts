import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { deleteConsignmentOrder, getPendingSettlements, paySettlement } from '@/actions/consignment';
import { getUnrestoredCancelledOrders, repairCancelledOrderStock } from '@/actions/lost-stock';
import { WEBSITE_ORDER_LOCKED, type SiteOrderData } from '@/lib/site-sale-data';

// Website orders are reversed only on the website, so the consignment and
// lost-stock tools must neither list them nor move their money or stock.

const PRICE = 1_000_000;
const QTY = 2;

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

function siteData(paid: number): SiteOrderData {
  return {
    issuedAt: '2026-09-01T10:00:00.000Z',
    tag: null,
    customer: { name: 'مریم رضایی', mobile: '09120000000', email: null, siteId: 'site-customer-1', ordersBefore: 0 },
    shipTo: null,
    shipping: null,
    payment: { gateway: null, trackId: null, refNumber: null, paidAt: null, amount: paid },
    subtotal: PRICE * QTY,
    discount: 0,
    coupon: null,
    total: PRICE * QTY,
    unknownLines: [],
    history: [],
    review: [],
  };
}

/** A website customer and the warehouse the site sells from; `partner` also gives them a consignment warehouse. */
async function setup(partner: boolean) {
  const customer = await prisma.customer.create({
    data: { name: 'مریم رضایی', phone: '09120000000', siteId: 'site-customer-1' },
  });
  const partnerWarehouse = partner
    ? await prisma.warehouse.create({ data: { name: `انبار امانی - ${customer.name}`, isVirtual: true, customerId: customer.id } })
    : null;
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const product = await prisma.product.create({
    data: { name: 'PANJ - Blue', sku: 'PANJ/BLUE', webId: 'MOAK-PANJ-BLUE', costPrice: 1, sellPrice: PRICE },
  });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: 10 } });
  const account = await prisma.account.create({ data: { name: 'درگاه سایت', type: 'BANK', currency: 'TOMAN' } });
  return { customer, partnerWarehouse, warehouse, product, account };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function websiteOrder(
  s: Setup,
  paid: number,
  fields: { status: string; totalAmount: number; paidAmount: number; paymentStatus?: string; transactionId?: string },
) {
  return prisma.order.create({
    data: {
      ...fields,
      customerId: s.customer.id,
      siteReference: 'MOAK-1001',
      siteData: siteData(paid),
      items: { create: [{ productId: s.product.id, warehouseId: s.warehouse.id, quantity: QTY, price: PRICE }] },
    },
  });
}

async function stock(s: Setup) {
  const row = await prisma.inventory.findUniqueOrThrow({
    where: { productId_warehouseId: { productId: s.product.id, warehouseId: s.warehouse.id } },
  });
  return row.quantity;
}

test('an unpaid website order of a consignment partner is not a settlement and cannot be paid or deleted there', async () => {
  const s = await setup(true);
  const web = await websiteOrder(s, 0, { status: 'COMPLETED', paymentStatus: 'UNPAID', totalAmount: PRICE * QTY, paidAmount: 0 });
  const consignment = await prisma.order.create({
    data: {
      customerId: s.customer.id,
      status: 'COMPLETED',
      paymentStatus: 'UNPAID',
      totalAmount: PRICE,
      paidAmount: 0,
      items: { create: [{ productId: s.product.id, warehouseId: s.partnerWarehouse!.id, quantity: 1, price: PRICE }] },
    },
  });

  assert.deepEqual((await getPendingSettlements()).map((o: { id: string }) => o.id), [consignment.id]);

  const paid = await paySettlement({} as any, form({ orderId: web.id, accountId: s.account.id }));
  assert.equal(paid.message, WEBSITE_ORDER_LOCKED);

  const deleted = await deleteConsignmentOrder(web.id);
  assert.equal(deleted.message, WEBSITE_ORDER_LOCKED);

  const order = await prisma.order.findUniqueOrThrow({ where: { id: web.id }, include: { items: true } });
  assert.equal(order.paymentStatus, 'UNPAID');
  assert.equal(Number(order.paidAmount), 0);
  assert.equal(order.items.length, 1);
  assert.equal(await stock(s), 10);
  assert.equal(await prisma.transaction.count(), 0);
  assert.equal(await prisma.inventoryMovement.count(), 0);
  assert.equal(Number((await prisma.account.findUniqueOrThrow({ where: { id: s.account.id } })).balance), 0);
});

test('a cancelled website order that was not restocked is not lost stock and cannot be repaired; a normal one still is', async () => {
  const s = await setup(false);
  // Paid on the site, then fully refunded there without restock.
  const income = await prisma.transaction.create({
    data: { type: 'INCOME', category: 'Sales', amount: PRICE * QTY, amountInToman: PRICE * QTY, accountId: s.account.id, customerId: s.customer.id },
  });
  const web = await websiteOrder(s, PRICE * QTY, { status: 'CANCELLED', totalAmount: 0, paidAmount: 0, transactionId: income.id });
  const refund = await prisma.transaction.create({
    data: { type: 'EXPENSE', category: 'Return', amount: PRICE * QTY, amountInToman: PRICE * QTY, accountId: s.account.id, customerId: s.customer.id },
  });
  await prisma.siteRefund.create({
    data: { orderId: web.id, refundId: 'refund-1', transactionId: refund.id, amount: PRICE * QTY, at: new Date() },
  });
  // Its warehouse is later deleted: ON DELETE SET NULL blanks the line, the
  // exact signature the lost-stock report looks for.
  await prisma.orderItem.updateMany({ where: { orderId: web.id }, data: { warehouseId: null } });

  const normal = await prisma.order.create({
    data: {
      status: 'CANCELLED',
      totalAmount: PRICE * QTY,
      items: { create: [{ productId: s.product.id, quantity: QTY, price: PRICE }] },
    },
  });

  assert.deepEqual((await getUnrestoredCancelledOrders()).map((o) => o.orderId), [normal.id]);

  const result = await repairCancelledOrderStock(web.id);
  assert.equal(result.success, false);
  assert.equal(result.message, WEBSITE_ORDER_LOCKED);
  assert.equal(await stock(s), 10);
  assert.equal(await prisma.inventoryMovement.count(), 0);
  assert.equal((await prisma.orderItem.findFirstOrThrow({ where: { orderId: web.id } })).warehouseId, null);

  const repaired = await repairCancelledOrderStock(normal.id);
  assert.equal(repaired.success, true, String(repaired.message));
});
