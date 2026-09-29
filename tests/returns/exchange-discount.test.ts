import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { exchangeOrderItem } from '@/actions/order-exchange';
import { exchangeChange, receivableNow, returnChange, swapDiscount } from '@/lib/return-math';
import {
  A, CHEAPER, PRICIER, SMALL, assertInvoice, giveBack, money, orderRow, sell, shop, swap, tillBalance, type Shop,
} from './invoice-helpers';

/**
 * Pooyan's rule for the discount in an exchange: the returned goods' share of
 * the order discount moves to the new goods, so the customer pays (or gets
 * back) the price difference alone. The share carried is at most what the new
 * goods are worth; the rest leaves the order, as on a plain return, which
 * keeps its own rule (the share leaves with the goods).
 */

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

// One 1,000,000 frame with 20% off: 800,000 paid.
const discounted = money({ totalAmount: A, discount: 200_000, paidAmount: 800_000 });
const RIZ = 150_000;

const exchangeRows = (orderId: string) =>
  prisma.transaction.findMany({ where: { orderId, category: 'Exchange' } }).then((rows: any[]) =>
    rows.map((row) => [row.type, Number(row.amountInToman)]),
  );
const priceDifference = async () => Number((await prisma.orderExchange.findFirstOrThrow()).priceDifference);

/** A frame cheaper than a 20% share of PANJ, in stock. */
async function riz(s: Shop) {
  const product = await prisma.product.create({ data: { name: 'RIZ', sku: 'RIZ', costPrice: 1, sellPrice: RIZ } });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: s.warehouse.id, quantity: 10 } });
  return product;
}

test('the rule, by the numbers: the share moves to the new goods, at most their worth; a plain return still takes it', () => {
  // Even swap: nothing to pay.
  assert.deepEqual(swapDiscount(discounted, A, A), { share: 200_000, carried: 200_000, lost: 0 });
  const even = exchangeChange(discounted, A, A, {});
  assert.deepEqual([even.newTotal, even.newDiscount, even.owedChange, even.newPaid, even.paymentStatus], [A, 200_000, 0, 800_000, 'PAID']);

  // Pricier: the price difference alone, and the discount stays.
  const pricier = exchangeChange(discounted, A, PRICIER, { receivedNow: 600_000 });
  assert.deepEqual(
    [pricier.newTotal, pricier.newDiscount, pricier.owedChange, pricier.cashIn, pricier.newPaid],
    [PRICIER, 200_000, 600_000, 600_000, 1_400_000],
  );
  assert.equal(receivableNow(discounted, A, PRICIER), 600_000);

  // Cheaper: the price difference, back.
  const cheaper = exchangeChange(discounted, A, CHEAPER, { refundNow: true });
  assert.deepEqual(
    [cheaper.newTotal, cheaper.newDiscount, cheaper.owedChange, cheaper.cashOut, cheaper.newPaid],
    [CHEAPER, 200_000, -300_000, 300_000, 500_000],
  );

  // New goods worth less than the share: 150,000 of it is carried, 50,000 leaves; the net stops at 0.
  assert.deepEqual(swapDiscount(discounted, A, RIZ), { share: 200_000, carried: RIZ, lost: 50_000 });
  const clamped = exchangeChange(discounted, A, RIZ, { refundNow: true });
  assert.deepEqual(
    [clamped.newTotal, clamped.newDiscount, clamped.owedChange, clamped.cashOut, clamped.newPaid, clamped.paymentStatus],
    [RIZ, RIZ, -800_000, 800_000, 0, 'PAID'],
  );

  // A plain return is unchanged: the whole share leaves with the goods.
  const order = money({ totalAmount: 2 * A, discount: 400_000, paidAmount: 1_600_000 });
  assert.deepEqual(swapDiscount(order, A, 0), { share: 200_000, carried: 0, lost: 200_000 });
  const back = returnChange(order, A);
  assert.deepEqual([back.newTotal, back.newDiscount, back.cashOut, back.owedChange], [A, 200_000, 800_000, -800_000]);
});

test('even swap on a 20% discounted order: the customer pays nothing and the discount stays', async () => {
  const s = await shop();
  const { order, invoiceId, line } = await sell(s, [['A', 1]], 200_000, 800_000);
  await swap(s, order.id, line('A').id, 'A', 1);

  assert.deepEqual(await orderRow(order.id), { total: A, discount: 200_000, paid: 800_000, status: 'PAID' });
  assert.equal(await priceDifference(), 0);
  assert.deepEqual(await exchangeRows(order.id), []);
  assert.equal(await tillBalance(s), 800_000);
  await assertInvoice(order.id, invoiceId, {
    lines: ['EXCHANGED PANJ (تعویض) ×1 = 1000000', 'SOLD PANJ (به‌جای PANJ (تعویض)) ×1 = 1000000'],
    rows: { goods: A, discount: 200_000, net: 800_000, paid: 800_000, remaining: 0 },
  });
});

test('pricier new goods: the customer pays the price difference, and the discount stays on the order', async () => {
  const s = await shop();
  const { order, invoiceId, line } = await sell(s, [['A', 1]], 200_000, 800_000);
  // Not a toman more than the price difference.
  const tooMuch = await exchangeOrderItem({}, form({
    orderId: order.id, originalItemId: line('A').id, exchangeProductId: s.p.PRICIER.id, quantity: '1', accountId: s.till.id,
    returnWarehouseId: s.warehouse.id, exchangeWarehouseId: s.warehouse.id, receivedNow: '600001',
  }));
  assert.equal(tooMuch.success, false);
  await swap(s, order.id, line('A').id, 'PRICIER', 1, { receivedNow: '600000' });

  assert.deepEqual(await orderRow(order.id), { total: PRICIER, discount: 200_000, paid: 1_400_000, status: 'PAID' });
  assert.equal(await priceDifference(), 600_000);
  assert.deepEqual(await exchangeRows(order.id), [['INCOME', 600_000]]);
  assert.equal(await tillBalance(s), 1_400_000);
  await assertInvoice(order.id, invoiceId, {
    lines: ['EXCHANGED PANJ (تعویض) ×1 = 1000000', 'SOLD HAFT (به‌جای PANJ (تعویض)) ×1 = 1600000'],
    rows: { goods: PRICIER, discount: 200_000, net: 1_400_000, paid: 1_400_000, remaining: 0 },
  });
});

test('cheaper new goods: the difference back is the price difference', async () => {
  const s = await shop();
  const { order, invoiceId, line } = await sell(s, [['A', 1]], 200_000, 800_000);
  await swap(s, order.id, line('A').id, 'CHEAPER', 1, { refundNow: '1' });

  assert.deepEqual(await orderRow(order.id), { total: CHEAPER, discount: 200_000, paid: 500_000, status: 'PAID' });
  assert.equal(await priceDifference(), -300_000);
  assert.deepEqual(await exchangeRows(order.id), [['EXPENSE', 300_000]]);
  assert.equal(await tillBalance(s), 500_000);
  await assertInvoice(order.id, invoiceId, {
    lines: ['EXCHANGED PANJ (تعویض) ×1 = 1000000', 'SOLD YEK (به‌جای PANJ (تعویض)) ×1 = 700000'],
    rows: { goods: CHEAPER, discount: 200_000, net: 500_000, paid: 500_000, remaining: 0 },
  });
});

test('one item back and several out: the share stays on the order as a whole', async () => {
  const s = await shop();
  const { order, invoiceId, line } = await sell(s, [['A', 1]], 200_000, 800_000);
  const r = await exchangeOrderItem({}, form({
    orderId: order.id, originalItemId: line('A').id, quantity: '1', accountId: s.till.id, returnWarehouseId: s.warehouse.id,
    lines: JSON.stringify([
      { productId: s.p.SMALL.id, quantity: 2, warehouseId: s.warehouse.id },
      { productId: s.p.CHEAPER.id, quantity: 1, price: 650_000, warehouseId: s.warehouse.id },
    ]),
    receivedNow: '650000',
  }));
  assert.equal(r.success, true, r.message);

  // 1,650,000 of new goods for 1,000,000 back: 650,000 more; the 200,000 discount is still one amount.
  assert.deepEqual(await orderRow(order.id), { total: 2 * SMALL + 650_000, discount: 200_000, paid: 1_450_000, status: 'PAID' });
  assert.equal(await priceDifference(), 650_000);
  assert.deepEqual(await exchangeRows(order.id), [['INCOME', 650_000]]);
  await assertInvoice(order.id, invoiceId, {
    lines: [
      'EXCHANGED PANJ (تعویض) ×1 = 1000000',
      'SOLD DO (به‌جای PANJ (تعویض)) ×2 = 1000000',
      'SOLD YEK (به‌جای PANJ (تعویض)) ×1 = 650000',
    ],
    rows: { goods: 1_650_000, discount: 200_000, net: 1_450_000, paid: 1_450_000, remaining: 0 },
  });
});

test('new goods worth less than the share: the carried share stops at their worth, the net at zero', async () => {
  const s = await shop();
  const product = await riz(s);
  const { order, invoiceId, line } = await sell(s, [['A', 1]], 200_000, 800_000);
  const r = await exchangeOrderItem({}, form({
    orderId: order.id, originalItemId: line('A').id, exchangeProductId: product.id, quantity: '1', accountId: s.till.id,
    returnWarehouseId: s.warehouse.id, exchangeWarehouseId: s.warehouse.id, refundNow: '1',
  }));
  assert.equal(r.success, true, r.message);

  // 150,000 of the 200,000 share is carried; 50,000 leaves the order. Everything paid comes back.
  assert.deepEqual(await orderRow(order.id), { total: RIZ, discount: RIZ, paid: 0, status: 'PAID' });
  assert.equal(await priceDifference(), -800_000);
  assert.deepEqual(await exchangeRows(order.id), [['EXPENSE', 800_000]]);
  assert.equal(await tillBalance(s), 0);
  await assertInvoice(order.id, invoiceId, {
    lines: ['EXCHANGED PANJ (تعویض) ×1 = 1000000', 'SOLD RIZ (به‌جای PANJ (تعویض)) ×1 = 150000'],
    rows: { goods: RIZ, discount: RIZ, net: 0, paid: 0, remaining: 0 },
  });
});

test('on a larger order, the share that cannot be carried leaves as on a return', async () => {
  const s = await shop();
  const product = await riz(s);
  const { order, invoiceId, line } = await sell(s, [['A', 2]], 400_000, 1_600_000);
  const r = await exchangeOrderItem({}, form({
    orderId: order.id, originalItemId: line('A').id, exchangeProductId: product.id, quantity: '1', accountId: s.till.id,
    returnWarehouseId: s.warehouse.id, exchangeWarehouseId: s.warehouse.id, refundNow: '1',
  }));
  assert.equal(r.success, true, r.message);

  // The frame kept keeps its 200,000; RIZ carries 150,000 of the other's; 50,000 leaves.
  assert.deepEqual(await orderRow(order.id), { total: A + RIZ, discount: 350_000, paid: 800_000, status: 'PAID' });
  assert.equal(await priceDifference(), -800_000);
  assert.deepEqual(await exchangeRows(order.id), [['EXPENSE', 800_000]]);
  await assertInvoice(order.id, invoiceId, {
    lines: [
      'SOLD PANJ ×1 = 1000000',
      'EXCHANGED PANJ (تعویض) ×1 = 1000000',
      'SOLD RIZ (به‌جای PANJ (تعویض)) ×1 = 150000',
    ],
    rows: { goods: A + RIZ, discount: 350_000, net: 800_000, paid: 800_000, remaining: 0 },
  });

  // A later plain return keeps rule A on the order as it now stands (the discount is one amount
  // for the whole order): 1,000,000 × 350,000 ÷ 1,150,000 = 304,348 leaves with the frame.
  await giveBack(s, order.id, line('A').id, 1);
  assert.deepEqual(await orderRow(order.id), { total: RIZ, discount: 350_000 - 304_348, paid: RIZ - 45_652, status: 'PAID' });
  assert.equal(await tillBalance(s), 800_000 - 695_652);
});
