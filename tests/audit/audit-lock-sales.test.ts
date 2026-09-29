import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { createInventoryAudit, freezeInventory } from '@/actions/inventory-audit';
import { createOrder } from '@/actions/sales';
import { returnOrderItem } from '@/actions/order-return';
import { exchangeOrderItem } from '@/actions/order-exchange';
import {
  createConsignmentPartner,
  recordConsignmentSales,
  returnConsignmentStock,
  transferStock as sendToPartner,
  transferStockBatch as sendBatchToPartner,
} from '@/actions/consignment';
import { createMarketingGift } from '@/actions/marketing';
import { giftProductToCustomer } from '@/actions/promotion';
import { POST } from '@/app/api/erp/route';
import { CHANNELS_FIELD } from '@/lib/consignment-channels';
import { assertStockInvariants, qty, stockSnapshot, stockUp } from '../inventory/stock';

// Pooyan's rule: no stock moves in a warehouse while it is being counted (src/lib/audit-stock-lock.ts). The
// inventory branch guarded the stock screens; these are the sales, consignment, marketing, return and exchange
// writers. The website is the exception: it sells during a count, and only holds the audit.

console.log = () => {};
console.error = () => {};

const UNDER_AUDIT = /^انبار «(مرکزی|انبار امانی - همکار)» در حال انبارگردانی است \(AUD-\d{4}-\d{4}\)؛ تا صدور اسناد اصلاحی، موجودی این انبار تغییر نمی‌کند\.$/;
const PRICE = 2_000_000;
let main: { id: string };
let shop: { id: string };
let till: { id: string };
let customer: { id: string };

beforeEach(async () => {
  beforeQuery.fn = null;
  setTestRole('ADMIN');
  await resetDatabase();
  await prisma.user.create({ data: { id: 'test-user', name: 'Owner', email: 'owner@x.test', password: 'x', role: 'ADMIN' } });
  main = await prisma.warehouse.create({ data: { id: 'wh-main', name: 'مرکزی' } });
  shop = await prisma.warehouse.create({ data: { id: 'wh-shop', name: 'فروشگاه' } });
  await prisma.product.create({ data: { id: 'panj', name: 'PANJ', sku: 'PANJ', webId: 'MOAK-PANJ', costPrice: 700_000, sellPrice: PRICE } });
  await stockUp('panj', main.id, 5);
  await stockUp('panj', shop.id, 2);
  till = await prisma.account.create({ data: { name: 'صندوق', type: 'CASH', currency: 'TOMAN', balance: 0 } });
  customer = await prisma.customer.create({ data: { name: 'سارا' } });
});
after(() => prisma.$disconnect());

async function audit(warehouseId = main.id, freeze = true) {
  const created = await createInventoryAudit(undefined, form({ warehouseId }));
  assert.equal(created.success, true, created.message);
  if (freeze) assert.equal((await freezeInventory(created.data!.auditId)).success, true);
  return created.data!.auditId;
}

const sell = (warehouseId: string | undefined, quantity = 1) =>
  createOrder({
    customerId: customer.id,
    items: [{ productId: 'panj', quantity, price: PRICE }],
    paymentMethod: 'CASH',
    accountId: till.id,
    totalAmount: quantity * PRICE,
    discount: 0,
    paidAmount: 0,
    warehouseId,
  });

/** Everything a refused write must leave alone: stock, movements, money and orders. */
async function books() {
  return JSON.parse(JSON.stringify({
    stock: await stockSnapshot(),
    transactions: await prisma.transaction.findMany({ orderBy: { id: 'asc' } }),
    orders: await prisma.order.findMany({ include: { items: true }, orderBy: { id: 'asc' } }),
    returns: await prisma.orderReturn.findMany(),
    exchanges: await prisma.orderExchange.findMany(),
    gifts: await prisma.marketingGift.findMany(),
    accounts: await prisma.account.findMany({ orderBy: { id: 'asc' } }),
  }));
}

test('a POS sale, a return and an exchange refuse a warehouse under audit, in Persian, and write nothing', async () => {
  // A sale from the shop, before the count starts.
  assert.equal((await sell(shop.id)).success, true);
  const order = await prisma.order.findFirstOrThrow({ include: { items: true } });
  await audit();
  const before = await books();

  const sale = await sell(main.id);
  assert.equal(sale.success, false);
  assert.match(sale.message!, UNDER_AUDIT);

  const back = await returnOrderItem({}, form({ orderId: order.id, orderItemId: order.items[0].id, quantity: '1', accountId: till.id, warehouseId: main.id }));
  assert.equal(back.success, false);
  assert.match(back.message, UNDER_AUDIT);

  for (const [returnWarehouseId, exchangeWarehouseId] of [[main.id, shop.id], [shop.id, main.id]]) {
    const swapped = await exchangeOrderItem({}, form({
      orderId: order.id, originalItemId: order.items[0].id, exchangeProductId: 'panj', quantity: '1',
      accountId: till.id, returnWarehouseId, exchangeWarehouseId,
    }));
    assert.equal(swapped.success, false, `${returnWarehouseId} → ${exchangeWarehouseId}`);
    assert.match(swapped.message, UNDER_AUDIT);
  }
  assert.deepEqual(await books(), before);

  // The shop is not being counted: returns, exchanges and sales there go on.
  const ok = await returnOrderItem({}, form({ orderId: order.id, orderItemId: order.items[0].id, quantity: '1', accountId: till.id, warehouseId: shop.id }));
  assert.equal(ok.success, true, ok.message);
  await assertStockInvariants();
});

test('a POS sale with no warehouse chosen takes the stock from a warehouse not being counted', async () => {
  await audit();
  // Main holds more, but it is being counted: the shop's two go.
  assert.equal((await sell(undefined, 2)).success, true);
  assert.deepEqual([await qty('panj', main.id), await qty('panj', shop.id)], [5, 0]);
  // Only main could cover one more: the audit is the reason given.
  const refused = await sell(undefined, 1);
  assert.equal(refused.success, false);
  assert.match(refused.message!, UNDER_AUDIT);
  await assertStockInvariants();
});

test('consignment transfers, reported sales and returns refuse a warehouse under audit', async () => {
  const created = await createConsignmentPartner(
    undefined,
    form({ name: 'همکار', [CHANNELS_FIELD]: JSON.stringify([{ name: 'آنلاین', commissionRate: 20, isDefault: true, isActive: true }]) }),
  );
  assert.equal(created.message, 'همکار امانی با موفقیت ایجاد شد.');
  const partner = await prisma.warehouse.findFirstOrThrow({ where: { isVirtual: true } });
  await stockUp('panj', partner.id, 3);
  await audit(main.id);
  const before = await books();

  const results: Array<[string, any]> = [
    ['send', await sendToPartner(undefined as any, form({ sourceWarehouseId: main.id, targetWarehouseId: partner.id, productId: 'panj', quantity: '1' }))],
    ['send batch', await sendBatchToPartner({ sourceWarehouseId: main.id, targetWarehouseId: partner.id, items: [{ productId: 'panj', quantity: 1 }] })],
    ['back', await returnConsignmentStock({ partnerWarehouseId: partner.id, targetWarehouseId: main.id, items: [{ productId: 'panj', quantity: 1 }] })],
  ];
  for (const [label, result] of results) assert.match(result.message, UNDER_AUDIT, label);
  assert.deepEqual(await books(), before);

  // The partner's own warehouse under audit: its reported sales wait for the count.
  await audit(partner.id);
  const sold = await recordConsignmentSales({ partnerWarehouseId: partner.id, saleDate: '2026-09-20', items: [{ productId: 'panj', quantity: 1, unitPrice: PRICE }] });
  assert.match(sold.message!, UNDER_AUDIT);
  assert.deepEqual(await books(), before);
  // Nor does stock go to the partner from the shop, which is free: the partner's warehouse is being counted.
  const sent = await sendToPartner(undefined as any, form({ sourceWarehouseId: shop.id, targetWarehouseId: partner.id, productId: 'panj', quantity: '1' }));
  assert.match(sent.message!, UNDER_AUDIT);
  assert.deepEqual(await books(), before);
});

test('a marketing gift and a gift to a customer refuse a warehouse under audit', async () => {
  const expense = await prisma.account.create({ data: { name: 'Marketing Expenses', type: 'EXPENSE', currency: 'TOMAN', balance: 0 } });
  await audit();
  const before = await books();
  const gift = await createMarketingGift(undefined as any, form({
    items: JSON.stringify([{ productId: 'panj', quantity: 1, warehouseId: main.id }]),
    recipientName: 'اینفلوئنسر', accountId: expense.id, notes: '', date: '2026-09-20T08:00:00.000Z',
  }));
  assert.match(gift.message!, UNDER_AUDIT);
  const toCustomer = await giftProductToCustomer(customer.id, 'panj', 1, main.id);
  assert.equal(toCustomer.success, false);
  assert.match(toCustomer.message!, UNDER_AUDIT);
  assert.deepEqual(await books(), before);
  // From the shop, both go through.
  assert.equal((await giftProductToCustomer(customer.id, 'panj', 1, shop.id)).success, true);
  await assertStockInvariants();
});

test('the website sells from a warehouse under audit; a freeze that starts during its sale waits and counts it', async () => {
  process.env.ERP_API_SECRET = 'audit-lock-token';
  await prisma.account.create({ data: { name: 'بانک سامان', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  const id = await audit(main.id, false);
  let freezing: Promise<any> | null = null;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Inventory' || params.action !== 'upsert') return;
    beforeQuery.fn = null;
    freezing = freezeInventory(id);
    await Promise.race([freezing, sleep(500)]);
  };
  const res = await POST(new NextRequest('http://localhost/api/erp', {
    method: 'POST',
    headers: { authorization: 'Bearer audit-lock-token', 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'createSale', reference: 'M-LOCK1', issuedAt: '2026-09-20T10:00:00.000Z', tag: 'website', warehouseId: main.id,
      customer: { name: 'سارا', mobile: '09123456789', email: null, siteId: 's1', ordersBefore: 0 },
      shipTo: { province: 'تهران', city: 'تهران', address: 'ولیعصر', postal: '1234567890', note: null },
      shipping: { zone: 'tehran', carrier: 'تیپاکس', freight: 0, free: true, trackingCode: null },
      items: [{ webId: 'MOAK-PANJ', erpId: 'MOAK-PANJ', sku: null, productId: 'p', name: 'PANJ', quantity: 2, unitPrice: PRICE, lineTotal: 2 * PRICE }],
      subtotal: 2 * PRICE, discount: 0, coupon: null, total: 2 * PRICE, currency: 'toman',
      payment: { gateway: 'zibal', trackId: 'T1', refNumber: 'R1', paidAt: '2026-09-20T10:00:00.000Z', amount: 2 * PRICE },
    }),
  }));
  beforeQuery.fn = null;
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assert.equal((await freezing!).success, true);
  // The snapshot counts the sale: 5 − 2.
  const snapshot = await prisma.inventoryAuditSnapshot.findFirstOrThrow({ where: { auditId: id, productId: 'panj' } });
  assert.equal(snapshot.quantity, 3);
  assert.equal(await qty('panj', main.id), 3);
});
