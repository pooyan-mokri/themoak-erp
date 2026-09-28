import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { createOrder } from '@/actions/sales';
import { returnOrderItem } from '@/actions/order-return';
import { exchangeOrderItem } from '@/actions/order-exchange';
import { createConsignmentPartner, recordConsignmentSales } from '@/actions/consignment';
import { getProfitLossReport } from '@/actions/reports';
import { deleteExpense, getExpenseBreakdown } from '@/actions/accounting';
import { POST } from '@/app/api/erp/route';
import { CHANNELS_FIELD } from '@/lib/consignment-channels';
import { COGS_LABEL, COGS_SOURCES } from '@/lib/cogs';
import { assertInvariants, openAccount, quantityOf, snapshot, stockIn } from '../sales/world';

// Pooyan's rule: profit and loss is on a cost-of-goods-sold basis. Goods that leave on a sale book their cost,
// goods that come back take it off, and every stock change has its movement (src/lib/cogs.ts).

console.error = () => {};
console.log = () => {};

const A_COST = 400_000;
const A_PRICE = 1_000_000;
const B_COST = 600_000;
const B_PRICE = 1_600_000;
const C_COST = 100_000;
const C_PRICE = 300_000;

beforeEach(async () => {
  beforeQuery.fn = null;
  setTestRole('ADMIN');
  await resetDatabase();
  await prisma.user.create({ data: { id: 'test-user', name: 'Owner', email: 'owner@x.test', password: 'x', role: 'ADMIN' } });
});
after(() => prisma.$disconnect());

/** A shop holding 5 of each frame, a till, a customer. */
async function shop() {
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const back = await prisma.warehouse.create({ data: { name: 'انبار مرجوعی' } });
  const make = (id: string, cost: number, price: number) =>
    prisma.product.create({ data: { id, name: id.toUpperCase(), sku: id.toUpperCase(), costPrice: cost, sellPrice: price } });
  const a = await make('panj', A_COST, A_PRICE);
  const b = await make('haft', B_COST, B_PRICE);
  const c = await make('yek', C_COST, C_PRICE);
  for (const p of [a, b, c]) await stockIn(p.id, warehouse.id, 5);
  const till = await openAccount('صندوق', { type: 'CASH' });
  const customer = await prisma.customer.create({ data: { name: 'سارا' } });
  return { warehouse, back, a, b, c, till, customer };
}
type Shop = Awaited<ReturnType<typeof shop>>;

async function sell(s: Shop, quantity: number, paid: number) {
  const r = await createOrder({
    customerId: s.customer.id,
    items: [{ productId: s.a.id, quantity, price: A_PRICE }],
    paymentMethod: 'CASH',
    accountId: s.till.id,
    totalAmount: quantity * A_PRICE,
    discount: 0,
    paidAmount: paid,
    warehouseId: s.warehouse.id,
    saleDate: '2026-09-20T08:00:00.000Z',
  });
  assert.equal(r.success, true, r.message);
  return prisma.order.findFirstOrThrow({ orderBy: { number: 'desc' }, include: { items: true } });
}

const cogsRows = (orderId: string) =>
  prisma.transaction.findMany({ where: { orderId, category: 'COGS' }, orderBy: { createdAt: 'asc' } }).then((rows: any[]) =>
    rows.map((row) => [Number(row.amount), row.description, row.type]),
  );
const movementsOf = (orderId: string) =>
  prisma.inventoryMovement.findMany({ where: { referenceId: orderId }, orderBy: { createdAt: 'asc' } }).then((rows: any[]) =>
    rows.map((m) => [m.type, m.productId, m.fromWarehouseId, m.toWarehouseId, m.quantity]),
  );
const period = { from: new Date('2026-09-01T00:00:00.000Z'), to: new Date('2099-01-01T00:00:00.000Z') };

test('a return puts the unit back with a RETURN movement and takes its cost off the sale\'s COGS', async () => {
  const s = await shop();
  const order = await sell(s, 2, 2 * A_PRICE);
  assert.deepEqual(await cogsRows(order.id), [[2 * A_COST, `${COGS_SOURCES.pos} - سفارش #${order.number}`, 'EXPENSE']]);

  const r = await returnOrderItem({}, form({ orderId: order.id, orderItemId: order.items[0].id, quantity: '1', accountId: s.till.id, warehouseId: s.back.id }));
  assert.equal(r.success, true, r.message);

  assert.deepEqual([await quantityOf(s.a.id, s.warehouse.id), await quantityOf(s.a.id, s.back.id)], [3, 1]);
  assert.deepEqual(await movementsOf(order.id), [
    ['SALE', s.a.id, s.warehouse.id, null, 2],
    ['RETURN', s.a.id, null, s.back.id, 1],
  ]);
  assert.deepEqual(await cogsRows(order.id), [
    [2 * A_COST, `${COGS_SOURCES.pos} - سفارش #${order.number}`, 'EXPENSE'],
    [-A_COST, `${COGS_SOURCES.return} - سفارش #${order.number}`, 'EXPENSE'],
  ]);
  // The P&L: 2,000,000 sold, 1,000,000 refunded, one frame's cost left: 600,000.
  const pl = await getProfitLossReport(period.from, period.to);
  assert.deepEqual([pl.summary.income, pl.summary.cogs, pl.summary.netProfit], [2 * A_PRICE, A_COST, A_PRICE - A_COST]);
  // The expense breakdown shows cost of goods once, net of the frame that came back.
  const breakdown = await getExpenseBreakdown();
  assert.equal(breakdown.find((row: any) => row.category === COGS_LABEL)?.amount, A_COST);
  // The COGS account's balance never moves.
  assert.equal(Number((await prisma.account.findFirstOrThrow({ where: { type: 'EXPENSE' } })).balance), 0);
  await assertInvariants();
});

test('returning the rest takes the whole cost off; a sale from before COGS existed takes nothing off', async () => {
  const s = await shop();
  const order = await sell(s, 2, 0);
  for (let i = 0; i < 2; i++) {
    const r = await returnOrderItem({}, form({ orderId: order.id, orderItemId: order.items[0].id, quantity: '1', accountId: s.till.id, warehouseId: s.warehouse.id }));
    assert.equal(r.success, true, r.message);
  }
  const net = await prisma.transaction.aggregate({ where: { orderId: order.id, category: 'COGS' }, _sum: { amountInToman: true } });
  assert.equal(Number(net._sum.amountInToman), 0);

  // An older sale booked no COGS: its return must not take the P&L below what was booked.
  const older = await sell(s, 1, 0);
  await prisma.transaction.deleteMany({ where: { orderId: older.id, category: 'COGS' } });
  const r = await returnOrderItem({}, form({ orderId: older.id, orderItemId: older.items[0].id, quantity: '1', accountId: s.till.id, warehouseId: s.warehouse.id }));
  assert.equal(r.success, true, r.message);
  assert.deepEqual(await cogsRows(older.id), []);
  assert.deepEqual((await movementsOf(older.id)).map((m: any) => m[0]), ['SALE', 'RETURN']);
  assert.equal(await quantityOf(s.a.id, s.warehouse.id), 5);
  await assertInvariants();
});

test('an exchange moves the unit back in and each new line out, and moves COGS both ways', async () => {
  const s = await shop();
  const order = await sell(s, 1, A_PRICE);
  const lines = JSON.stringify([
    { productId: s.b.id, quantity: 1, warehouseId: s.warehouse.id },
    { productId: s.c.id, quantity: 2, warehouseId: s.warehouse.id },
  ]);
  const r = await exchangeOrderItem({}, form({
    orderId: order.id, originalItemId: order.items[0].id, quantity: '1', accountId: s.till.id,
    returnWarehouseId: s.back.id, lines, requestId: 'exchange-cogs-0001',
  }));
  assert.equal(r.success, true, r.message);

  assert.deepEqual(
    [await quantityOf(s.a.id, s.back.id), await quantityOf(s.b.id, s.warehouse.id), await quantityOf(s.c.id, s.warehouse.id)],
    [1, 4, 3],
  );
  assert.deepEqual(await movementsOf(order.id), [
    ['SALE', s.a.id, s.warehouse.id, null, 1],
    ['SALE', s.b.id, s.warehouse.id, null, 1],
    ['SALE', s.c.id, s.warehouse.id, null, 2],
    ['RETURN', s.a.id, null, s.back.id, 1],
  ]);
  assert.deepEqual(await cogsRows(order.id), [
    [A_COST, `${COGS_SOURCES.pos} - سفارش #${order.number}`, 'EXPENSE'],
    [-A_COST, `${COGS_SOURCES.exchangeBack} - سفارش #${order.number}`, 'EXPENSE'],
    [B_COST + 2 * C_COST, `${COGS_SOURCES.exchange} - سفارش #${order.number}`, 'EXPENSE'],
  ]);
  const pl = await getProfitLossReport(period.from, period.to);
  assert.equal(pl.summary.cogs, B_COST + 2 * C_COST);

  // Sent again: booked once, stock and COGS included.
  const before = await snapshot();
  const again = await exchangeOrderItem({}, form({
    orderId: order.id, originalItemId: order.items[0].id, quantity: '1', accountId: s.till.id,
    returnWarehouseId: s.back.id, lines, requestId: 'exchange-cogs-0001',
  }));
  assert.equal(again.success, true);
  assert.deepEqual(await snapshot(), before);
  await assertInvariants();
});

test('an exchange whose new goods a sale took meanwhile is refused, and writes nothing', async () => {
  const s = await shop();
  const order = await sell(s, 1, A_PRICE);
  const before = await snapshot();
  // Between the exchange's stock check and its decrement, the last frames are sold elsewhere.
  beforeQuery.fn = async (params) => {
    if (params.model === 'Inventory' && params.action === 'updateMany') {
      beforeQuery.fn = null;
      await prisma.$executeRawUnsafe(`UPDATE "Inventory" SET quantity = 0 WHERE "productId" = '${s.b.id}'`);
    }
  };
  const r = await exchangeOrderItem({}, form({
    orderId: order.id, originalItemId: order.items[0].id, exchangeProductId: s.b.id, quantity: '1',
    accountId: s.till.id, returnWarehouseId: s.warehouse.id, exchangeWarehouseId: s.warehouse.id, receivedNow: String(B_PRICE - A_PRICE),
  }));
  beforeQuery.fn = null;
  assert.equal(r.success, false);
  assert.equal(r.message, 'موجودی کافی برای کالای تعویضی "HAFT" در انبار انتخابی وجود ندارد.');
  // Nothing but the concurrent sale's own change.
  await prisma.$executeRawUnsafe(`UPDATE "Inventory" SET quantity = 5 WHERE "productId" = '${s.b.id}'`);
  assert.deepEqual(await snapshot(), before);
});

test('a partner\'s consignment sale returned to its warehouse moves the unit back there and takes its cost off', async () => {
  const created = await createConsignmentPartner(
    undefined,
    form({ name: 'همکار', [CHANNELS_FIELD]: JSON.stringify([{ name: 'آنلاین', commissionRate: 20, isDefault: true, isActive: true }]) }),
  );
  assert.equal(created.message, 'همکار امانی با موفقیت ایجاد شد.');
  const partner = await prisma.warehouse.findFirstOrThrow({ where: { isVirtual: true } });
  const frame = await prisma.product.create({ data: { id: 'panj', name: 'PANJ', sku: 'PANJ', costPrice: A_COST, sellPrice: A_PRICE } });
  await stockIn(frame.id, partner.id, 3);
  const bank = await openAccount('بانک');
  const sold = await recordConsignmentSales({ partnerWarehouseId: partner.id, saleDate: '2026-09-20', items: [{ productId: frame.id, quantity: 2, unitPrice: A_PRICE }] });
  assert.equal(sold.success, true, sold.message);
  const order = await prisma.order.findFirstOrThrow({ include: { items: true } });
  assert.deepEqual((await cogsRows(order.id)).map((row: any) => row[0]), [2 * A_COST]);

  const r = await returnOrderItem({}, form({ orderId: order.id, orderItemId: order.items[0].id, quantity: '1', accountId: bank.id, warehouseId: partner.id }));
  assert.equal(r.success, true, r.message);
  assert.equal(await quantityOf(frame.id, partner.id), 2);
  assert.deepEqual((await movementsOf(order.id)).map((m: any) => [m[0], m[3], m[4]]), [['SALE', null, 2], ['RETURN', partner.id, 1]]);
  assert.deepEqual(await cogsRows(order.id), [
    [2 * A_COST, `${COGS_SOURCES.consignment} - سفارش #${order.number}`, 'EXPENSE'],
    [-A_COST, `${COGS_SOURCES.return} - سفارش #${order.number}`, 'EXPENSE'],
  ]);
  await assertInvariants();
});

test('a website sale books its cost of goods; a restock takes it off again, once', async () => {
  process.env.ERP_API_SECRET = 'cogs-website-token';
  await openAccount('بانک سامان');
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  await prisma.product.create({ data: { id: 'panj', name: 'PANJ', sku: 'PANJ', webId: 'MOAK-PANJ', costPrice: A_COST, sellPrice: A_PRICE } });
  await stockIn('panj', warehouse.id, 4);
  const call = (body: Record<string, unknown>) =>
    POST(new NextRequest('http://localhost/api/erp', {
      method: 'POST',
      headers: { authorization: 'Bearer cogs-website-token', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));
  const sale = await call({
    action: 'createSale', reference: 'M-COGS1', issuedAt: '2026-09-20T10:00:00.000Z', tag: 'website', warehouseId: warehouse.id,
    customer: { name: 'سارا', mobile: '09123456789', email: null, siteId: 's1', ordersBefore: 0 },
    shipTo: { province: 'تهران', city: 'تهران', address: 'ولیعصر', postal: '1234567890', note: null },
    shipping: { zone: 'tehran', carrier: 'تیپاکس', freight: 0, free: true, trackingCode: null },
    items: [{ webId: 'MOAK-PANJ', erpId: 'MOAK-PANJ', sku: null, productId: 'p', name: 'PANJ', quantity: 2, unitPrice: A_PRICE, lineTotal: 2 * A_PRICE }],
    subtotal: 2 * A_PRICE, discount: 0, coupon: null, total: 2 * A_PRICE, currency: 'toman',
    payment: { gateway: 'zibal', trackId: 'T1', refNumber: 'R1', paidAt: '2026-09-20T10:00:00.000Z', amount: 2 * A_PRICE },
  });
  assert.equal(sale.status, 200, JSON.stringify(await sale.clone().json()));
  const order = await prisma.order.findFirstOrThrow({ where: { siteReference: 'M-COGS1' } });
  assert.deepEqual(await cogsRows(order.id), [[2 * A_COST, `${COGS_SOURCES.website} - سفارش #${order.number}`, 'EXPENSE']]);
  const cogsRow = await prisma.transaction.findFirstOrThrow({ where: { orderId: order.id, category: 'COGS' } });
  assert.equal(cogsRow.date.toISOString(), '2026-09-20T10:00:00.000Z');

  for (let i = 0; i < 2; i++) {
    const res = await call({ action: 'setSaleStatus', reference: 'M-COGS1', status: 'cancelled', restock: true, at: '2026-09-21T09:00:00.000Z' });
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  }
  assert.equal(await quantityOf('panj', warehouse.id), 4);
  assert.deepEqual(await cogsRows(order.id), [
    [2 * A_COST, `${COGS_SOURCES.website} - سفارش #${order.number}`, 'EXPENSE'],
    [-2 * A_COST, `${COGS_SOURCES.websiteRestock} - سفارش #${order.number}`, 'EXPENSE'],
  ]);
});

test('the expense list names a COGS row by its source, and refuses to delete it', async () => {
  const s = await shop();
  const order = await sell(s, 2, 0);
  const r = await returnOrderItem({}, form({ orderId: order.id, orderItemId: order.items[0].id, quantity: '1', accountId: s.till.id, warehouseId: s.warehouse.id }));
  assert.equal(r.success, true, r.message);
  const [sale, back] = await prisma.transaction.findMany({ where: { orderId: order.id, category: 'COGS' }, orderBy: { createdAt: 'asc' } });
  const refusal = (owner: string) => `این سند به‌صورت خودکار توسط «${owner}» ثبت شده است و باید از همان بخش اصلاح یا لغو شود.`;
  assert.equal((await deleteExpense(sale.id)).message, refusal(COGS_SOURCES.pos));
  assert.equal((await deleteExpense(back.id)).message, refusal(COGS_SOURCES.return));
  assert.equal(await prisma.transaction.count({ where: { orderId: order.id, category: 'COGS' } }), 2);
});
