import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { cancelOrder, createOrder, getCancelOrderPreview } from '@/actions/sales';
import { exchangeOrderItem, getAllOrderExchanges, getOrderExchanges } from '@/actions/order-exchange';
import { applyCustomerCredit, getCustomerCredit } from '@/actions/customer-credit';
import { calculateCustomerDebt, getCustomerById, getCustomersWithDebt } from '@/actions/customer';
import { DUPLICATE_REQUEST_MESSAGE } from '@/lib/request-id';
import {
  A, CHEAPER, PRICIER, SMALL, assertInvoice, giveBack, orderRow, readInvoice, render, sell, shop, swap, tillBalance, type Shop,
} from './invoice-helpers';
import PrintOrderPage from '@/app/dashboard/sales/orders/[id]/print/page';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const stock = async (productId: string, warehouseId: string) =>
  (await prisma.inventory.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } }))?.quantity ?? 0;
const balanceOf = (customerId: string) => getCustomerCredit(customerId);

/** An exchange of `quantity` units of a line for several new lines. */
function exchangeFor(
  s: Shop,
  orderId: string,
  itemId: string,
  quantity: number,
  lines: Array<{ productId: string; quantity: number; price?: number; warehouseId: string }>,
  extra: Record<string, string> = {},
) {
  return exchangeOrderItem(
    {},
    form({
      orderId, originalItemId: itemId, quantity: String(quantity), accountId: s.till.id,
      returnWarehouseId: s.warehouse.id, lines: JSON.stringify(lines), ...extra,
    }),
  );
}

// ── B. One item back, several items out ──────────────────────────────────────

test('one item back and two different items out (two of one), on the same order and invoice, booked once', async () => {
  const s = await shop();
  const annex = await prisma.warehouse.create({ data: { name: 'انبار دوم' } });
  await prisma.inventory.create({ data: { productId: s.p.CHEAPER.id, warehouseId: annex.id, quantity: 3 } });
  const { order, invoiceId, line } = await sell(s, [['A', 1]], 0, A);
  const tillBefore = await tillBalance(s);

  // Two DO at the catalog price from the main warehouse, one YEK at 650,000 (not its 700,000) from the annex.
  const lines = [
    { productId: s.p.SMALL.id, quantity: 2, warehouseId: s.warehouse.id },
    { productId: s.p.CHEAPER.id, quantity: 1, price: 650_000, warehouseId: annex.id },
  ];
  const request = { receivedNow: '400000', requestId: 'exchange-lines-0001' };
  const result = await exchangeFor(s, order.id, line('A').id, 1, lines, request);
  assert.equal(result.success, true, result.message);

  const check = async () => {
    // Stock: the frame back in its warehouse, each new line out of its own.
    assert.deepEqual(
      [await stock(s.p.A.id, s.warehouse.id), await stock(s.p.SMALL.id, s.warehouse.id), await stock(s.p.CHEAPER.id, annex.id), await stock(s.p.CHEAPER.id, s.warehouse.id)],
      [10, 8, 2, 10],
    );
    // Cash: only what was collected now.
    assert.equal(await tillBalance(s), tillBefore + 400_000);
    const rows = await prisma.transaction.findMany({ where: { orderId: order.id, category: 'Exchange' } });
    assert.deepEqual(rows.map((r: any) => [r.type, Number(r.amountInToman), r.accountId]), [['INCOME', 400_000, s.till.id]]);
    // The order: 1,000,000 of goods back, 1,650,000 out; 250,000 still owed.
    assert.deepEqual(await orderRow(order.id), { total: 1_650_000, discount: 0, paid: 1_400_000, status: 'PARTIAL' });
    const exchange = await prisma.orderExchange.findFirstOrThrow({ include: { issuedItems: { orderBy: { id: 'asc' } } } });
    assert.equal(exchange.quantity, 1);
    assert.equal(Number(exchange.priceDifference), 650_000);
    assert.deepEqual(
      exchange.issuedItems.map((i: any) => [i.productId, i.quantity, Number(i.price), i.warehouseId]),
      [[s.p.SMALL.id, 2, SMALL, s.warehouse.id], [s.p.CHEAPER.id, 1, 650_000, annex.id]],
    );
    assert.equal(exchange.exchangeItemId, exchange.issuedItems[0].id);
    assert.equal((await prisma.orderItem.findUniqueOrThrow({ where: { id: line('A').id } })).status, 'EXCHANGED');
    // The invoice: the returned line marked, both new lines named with what they replaced.
    await assertInvoice(order.id, invoiceId, {
      lines: [
        'EXCHANGED PANJ (تعویض) ×1 = 1000000',
        'SOLD DO (به‌جای PANJ (تعویض)) ×2 = 1000000',
        'SOLD YEK (به‌جای PANJ (تعویض)) ×1 = 650000',
      ],
      rows: { goods: 1_650_000, net: 1_650_000, paid: 1_400_000, remaining: 250_000 },
    });
    assert.equal(await calculateCustomerDebt(s.customer.id), 250_000);
  };
  await check();

  // The same submission again is booked once.
  const again = await exchangeFor(s, order.id, line('A').id, 1, lines, request);
  assert.deepEqual(again, { message: DUPLICATE_REQUEST_MESSAGE, success: true });
  assert.equal(await prisma.orderExchange.count(), 1);
  assert.equal(await prisma.orderItem.count({ where: { orderId: order.id } }), 3);
  await check();

  // The history lists every new line.
  const history = await getOrderExchanges(order.id);
  assert.equal((history[0] as any).issuedNames, 'DO × 2، YEK × 1');
  assert.equal((await getAllOrderExchanges())[0].exchangeProductName, 'DO × 2، YEK × 1');
});

test('a faulty unit can be swapped for a fresh unit of the same product', async () => {
  const s = await shop();
  const { order, invoiceId, line } = await sell(s, [['A', 1]], 0, A);
  const result = await exchangeFor(s, order.id, line('A').id, 1, [{ productId: s.p.A.id, quantity: 1, warehouseId: s.warehouse.id }]);
  assert.equal(result.success, true, result.message);
  assert.equal(await stock(s.p.A.id, s.warehouse.id), 9);
  assert.deepEqual(await orderRow(order.id), { total: A, discount: 0, paid: A, status: 'PAID' });
  await assertInvoice(order.id, invoiceId, {
    lines: ['EXCHANGED PANJ (تعویض) ×1 = 1000000', 'SOLD PANJ (به‌جای PANJ (تعویض)) ×1 = 1000000'],
    rows: { goods: A, net: A, paid: A, remaining: 0 },
  });
  // A line an exchange issued is not exchanged again.
  const issued = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id, exchangeId: { not: null } } });
  const chained = await exchangeFor(s, order.id, issued.id, 1, [{ productId: s.p.SMALL.id, quantity: 1, warehouseId: s.warehouse.id }]);
  assert.equal(chained.success, false);
});

test('new lines are checked against stock together, and a line with no product is refused', async () => {
  const s = await shop();
  const { order, line } = await sell(s, [['A', 1]], 0, A);
  // 6 + 5 of DO from a warehouse holding 10.
  const tooMany = await exchangeFor(s, order.id, line('A').id, 1, [
    { productId: s.p.SMALL.id, quantity: 6, warehouseId: s.warehouse.id },
    { productId: s.p.SMALL.id, quantity: 5, warehouseId: s.warehouse.id },
  ]);
  assert.equal(tooMany.success, false);
  assert.match(tooMany.message, /موجودی کافی/);
  const empty = await exchangeFor(s, order.id, line('A').id, 1, []);
  assert.equal(empty.success, false);
  assert.equal(await prisma.orderExchange.count(), 0);
  assert.equal(await stock(s.p.SMALL.id, s.warehouse.id), 10);
});

test('an even swap submitted twice, even at the same moment, is booked once', async () => {
  const s = await shop();
  const { order, invoiceId, line } = await sell(s, [['A', 1]], 0, A);
  // DO at the frame's price: nothing is owed, collected, refunded or credited.
  const lines = [{ productId: s.p.SMALL.id, quantity: 1, price: A, warehouseId: s.warehouse.id }];
  const submit = () => exchangeFor(s, order.id, line('A').id, 1, lines, { requestId: 'even-swap-000001' });

  const [first, second] = await Promise.all([submit(), submit()]);
  const results = [first, second].map((r) => r.message).sort();
  assert.deepEqual(results, [DUPLICATE_REQUEST_MESSAGE, 'تعویض کالا با موفقیت ثبت شد.'].sort());
  assert.equal(first.success && second.success, true);
  const third = await submit();
  assert.deepEqual(third, { message: DUPLICATE_REQUEST_MESSAGE, success: true });

  const exchanges = await prisma.orderExchange.findMany();
  assert.deepEqual(exchanges.map((x: any) => [x.clientRequestId, Number(x.priceDifference)]), [['even-swap-000001', 0]]);
  assert.equal(await prisma.orderItem.count({ where: { orderId: order.id } }), 2);
  assert.deepEqual([await stock(s.p.A.id, s.warehouse.id), await stock(s.p.SMALL.id, s.warehouse.id)], [10, 9]);
  assert.equal(await prisma.transaction.count({ where: { category: 'Exchange' } }), 0);
  assert.equal(await prisma.customerCredit.count(), 0);
  assert.deepEqual(await orderRow(order.id), { total: A, discount: 0, paid: A, status: 'PAID' });
  await assertInvoice(order.id, invoiceId, {
    lines: ['EXCHANGED PANJ (تعویض) ×1 = 1000000', 'SOLD DO (به‌جای PANJ (تعویض)) ×1 = 1000000'],
    rows: { goods: A, net: A, paid: A, remaining: 0 },
  });
});

test('an exchange whose whole difference is left as debt, submitted twice, is booked once', async () => {
  const s = await shop();
  const { order, line } = await sell(s, [['A', 1]], 0, A);
  // The one-for-one form, as the old dialog and other callers send it; nothing collected now.
  const submit = () =>
    exchangeOrderItem({}, form({
      orderId: order.id, originalItemId: line('A').id, exchangeProductId: s.p.PRICIER.id, quantity: '1', accountId: s.till.id,
      returnWarehouseId: s.warehouse.id, exchangeWarehouseId: s.warehouse.id, requestId: 'debt-only-000001',
    }));

  const first = await submit();
  assert.deepEqual(first, { message: 'تعویض کالا با موفقیت ثبت شد.', success: true });
  const again = await submit();
  assert.deepEqual(again, { message: DUPLICATE_REQUEST_MESSAGE, success: true });

  assert.equal(await prisma.orderExchange.count(), 1);
  assert.equal(await prisma.orderItem.count({ where: { orderId: order.id } }), 2);
  assert.deepEqual([await stock(s.p.A.id, s.warehouse.id), await stock(s.p.PRICIER.id, s.warehouse.id)], [10, 9]);
  assert.equal(await prisma.transaction.count({ where: { category: 'Exchange' } }), 0);
  assert.deepEqual(await orderRow(order.id), { total: PRICIER, discount: 0, paid: A, status: 'PARTIAL' });
  assert.equal(await calculateCustomerDebt(s.customer.id), PRICIER - A);
});

// ── C. Customer credit ───────────────────────────────────────────────────────

test('invoice: a cheaper exchange with the difference put on the customer\'s credit', async () => {
  const s = await shop();
  const { order, invoiceId, line } = await sell(s, [['A', 1]], 0, A);
  await swap(s, order.id, line('A').id, 'CHEAPER', 1, { toCredit: '1', requestId: 'credit-exchange-01' });

  // No cash moved; the order is paid exactly its net; the rest is the customer's credit.
  assert.equal(await tillBalance(s), A);
  assert.equal(await prisma.transaction.count({ where: { category: 'Exchange' } }), 0);
  assert.deepEqual(await orderRow(order.id), { total: CHEAPER, discount: 0, paid: CHEAPER, status: 'PAID' });
  const exchange = await prisma.orderExchange.findFirstOrThrow();
  const credit = await prisma.customerCredit.findFirstOrThrow();
  assert.deepEqual(
    [Number(credit.amount), credit.orderId, credit.exchangeId, credit.reason, credit.customerId],
    [300_000, order.id, exchange.id, 'EXCHANGE', s.customer.id],
  );
  assert.equal(await balanceOf(s.customer.id), 300_000);
  await assertInvoice(order.id, invoiceId, {
    lines: ['EXCHANGED PANJ (تعویض) ×1 = 1000000', 'SOLD YEK (به‌جای PANJ (تعویض)) ×1 = 700000'],
    rows: { goods: CHEAPER, net: CHEAPER, paid: CHEAPER, remaining: 0, customerCredit: 300_000 },
  });
  // Every customer screen shows it as credit, none as debt.
  const profile: any = await getCustomerById(s.customer.id);
  const listed: any = (await getCustomersWithDebt()).find((c: any) => c.id === s.customer.id);
  assert.deepEqual([profile.stats.totalDebt, profile.stats.totalCredit, listed.totalDebt, listed.totalCredit], [0, 300_000, 0, 300_000]);
  // The history says where the difference went.
  assert.equal((await getOrderExchanges(order.id))[0].toCredit, 300_000);

  // Submitted twice: booked once.
  const again = await exchangeOrderItem({}, form({
    orderId: order.id, originalItemId: line('A').id, exchangeProductId: s.p.CHEAPER.id, quantity: '1', accountId: s.till.id,
    returnWarehouseId: s.warehouse.id, exchangeWarehouseId: s.warehouse.id, toCredit: '1', requestId: 'credit-exchange-01',
  }));
  assert.deepEqual(again, { message: DUPLICATE_REQUEST_MESSAGE, success: true });
  assert.equal(await balanceOf(s.customer.id), 300_000);
});

test('an order without a customer cannot put a difference on credit', async () => {
  const s = await shop();
  const walkIn = await prisma.order.create({
    data: { totalAmount: A, paidAmount: A, items: { create: [{ productId: s.p.A.id, quantity: 1, price: A, warehouseId: s.warehouse.id }] } },
    include: { items: true },
  });
  const r = await exchangeOrderItem({}, form({
    orderId: walkIn.id, originalItemId: walkIn.items[0].id, exchangeProductId: s.p.CHEAPER.id, quantity: '1', accountId: s.till.id,
    returnWarehouseId: s.warehouse.id, exchangeWarehouseId: s.warehouse.id, toCredit: '1',
  }));
  assert.equal(r.success, false);
  assert.equal(await prisma.customerCredit.count(), 0);
});

/** A customer holding 300,000 of credit from a cheaper exchange. */
async function withCredit() {
  const s = await shop();
  const first = await sell(s, [['A', 1]], 0, A);
  await swap(s, first.order.id, first.line('A').id, 'CHEAPER', 1, { toCredit: '1' });
  assert.equal(await balanceOf(s.customer.id), 300_000);
  return s;
}

const posSale = (s: Shop, fields: { price: number; paid: number; credit: number; requestId?: string }) =>
  createOrder({
    customerId: s.customer.id, items: [{ productId: s.p.SMALL.id, quantity: 1, price: fields.price }], paymentMethod: 'CASH',
    accountId: s.till.id, totalAmount: fields.price, discount: 0, paidAmount: fields.paid, creditUsed: fields.credit,
    warehouseId: s.warehouse.id, requestId: fields.requestId,
  });

test('credit pays part of a later POS sale: no cash row for it, the balance goes down, capped at the balance', async () => {
  const s = await withCredit();
  const till = await tillBalance(s);

  // More than the balance, or more than the sale, is refused.
  assert.equal((await posSale(s, { price: SMALL, paid: 100_000, credit: 400_000 })).success, false);
  assert.equal((await posSale(s, { price: SMALL, paid: 300_000, credit: 300_000 })).success, false);
  assert.equal(await prisma.order.count({ where: { totalAmount: SMALL } }), 0);

  const r: any = await posSale(s, { price: SMALL, paid: 200_000, credit: 300_000, requestId: 'pos-credit-0001' });
  assert.equal(r.success, true, r.message);
  const order = await prisma.order.findFirstOrThrow({ where: { totalAmount: SMALL } });
  assert.deepEqual(await orderRow(order.id), { total: SMALL, discount: 0, paid: SMALL, status: 'PAID' });
  // Only the cash part is a money row.
  const rows = await prisma.transaction.findMany({ where: { orderId: order.id } });
  assert.deepEqual(rows.map((t: any) => [t.type, Number(t.amountInToman)]), [['INCOME', 200_000]]);
  assert.equal(await tillBalance(s), till + 200_000);
  assert.equal(await balanceOf(s.customer.id), 0);
  const used = await prisma.customerCredit.findFirstOrThrow({ where: { orderId: order.id } });
  assert.deepEqual([Number(used.amount), used.reason], [-300_000, 'PAYMENT']);

  // Retried: booked once.
  const again: any = await posSale(s, { price: SMALL, paid: 200_000, credit: 300_000, requestId: 'pos-credit-0001' });
  assert.equal(again.message, DUPLICATE_REQUEST_MESSAGE);
  assert.equal(await prisma.order.count({ where: { totalAmount: SMALL } }), 1);
  assert.equal(await balanceOf(s.customer.id), 0);
});

test('a sale paid entirely from credit writes no money row, and is booked once', async () => {
  const s = await withCredit();
  const price = 300_000;
  const r: any = await posSale(s, { price, paid: 0, credit: price, requestId: 'pos-credit-only-01' });
  assert.equal(r.success, true, r.message);
  const again: any = await posSale(s, { price, paid: 0, credit: price, requestId: 'pos-credit-only-01' });
  assert.equal(again.message, DUPLICATE_REQUEST_MESSAGE);
  const order = await prisma.order.findFirstOrThrow({ where: { totalAmount: price } });
  assert.deepEqual(await orderRow(order.id), { total: price, discount: 0, paid: price, status: 'PAID' });
  assert.equal(await prisma.transaction.count({ where: { orderId: order.id } }), 0);
  assert.equal(await balanceOf(s.customer.id), 0);

  // Cancelling it gives the credit back, and the cancelled order is no debt.
  const preview: any = await getCancelOrderPreview(order.id);
  assert.equal(preview.success, true, preview.message);
  assert.equal(preview.creditReturned, price);
  assert.equal((await cancelOrder(order.id, preview.moneyRowIds)).success, true);
  assert.equal(await balanceOf(s.customer.id), 300_000);
  assert.equal(await calculateCustomerDebt(s.customer.id), 0);
});

test('credit pays an order from the payment dialog: no cash row, capped at the balance and at what is owed', async () => {
  const s = await withCredit();
  const unpaid = await sell(s, [['PRICIER', 1]], 0, 0);
  const almostPaid = await sell(s, [['SMALL', 1]], 0, 400_000);
  const till = await tillBalance(s);
  const moneyRows = () => prisma.transaction.count({ where: { orderId: { in: [unpaid.order.id, almostPaid.order.id] } } });
  const rowsBefore = await moneyRows();

  // At most what the order still owes (100,000), even with 300,000 of credit.
  const over = await applyCustomerCredit(almostPaid.order.id, 300_000, 'dialog-credit-0001');
  assert.equal(over.success, false);
  assert.match(over.message, /۱۰۰٬۰۰۰/);
  const small = await applyCustomerCredit(almostPaid.order.id, 100_000, 'dialog-credit-0002');
  assert.equal(small.success, true, small.message);
  assert.deepEqual(await orderRow(almostPaid.order.id), { total: SMALL, discount: 0, paid: SMALL, status: 'PAID' });
  assert.equal(await balanceOf(s.customer.id), 200_000);

  // At most the balance (200,000) on an order owing 1,600,000.
  assert.equal((await applyCustomerCredit(unpaid.order.id, 250_000)).success, false);
  const rest = await applyCustomerCredit(unpaid.order.id, 200_000, 'dialog-credit-0003');
  assert.equal(rest.success, true, rest.message);
  const retried = await applyCustomerCredit(unpaid.order.id, 200_000, 'dialog-credit-0003');
  assert.deepEqual(retried, { success: true, message: DUPLICATE_REQUEST_MESSAGE });
  assert.deepEqual(await orderRow(unpaid.order.id), { total: PRICIER, discount: 0, paid: 200_000, status: 'PARTIAL' });
  assert.equal(await balanceOf(s.customer.id), 0);
  assert.equal((await applyCustomerCredit(unpaid.order.id, 1)).success, false);

  // No money moved and no money row was written for any of it.
  assert.equal(await tillBalance(s), till);
  assert.equal(await moneyRows(), rowsBefore);
  // The invoice counts it as paid.
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: unpaid.invoiceId } });
  assert.deepEqual([Number(invoice.paidAmount), invoice.status], [200_000, 'PARTIAL']);
  assert.equal(await calculateCustomerDebt(s.customer.id), 1_400_000);

  // Using credit needs the permission a payment needs.
  setTestRole('AUDITOR');
  assert.equal(await getCustomerCredit(s.customer.id), 0);
  assert.equal((await applyCustomerCredit(unpaid.order.id, 1)).success, false);
});

// ── The exchangeId backfill and the read-only reports ────────────────────────

const sql = (name: string) => readFileSync(join(process.cwd(), 'prisma/sql', name), 'utf8');

test('the exchangeId backfill marks the line each old exchange issued, once, and the invoice reads the same before and after', async () => {
  const s = await shop();
  const { order, line } = await sell(s, [['A', 2]], 0, 2 * A);
  // Two exchanges written the old way: the new line only named by exchangeItemId.
  const old = async (productId: string, price: number) => {
    const issued = await prisma.orderItem.create({ data: { orderId: order.id, productId, quantity: 1, price, warehouseId: s.warehouse.id } });
    const exchange = await prisma.orderExchange.create({
      data: { orderId: order.id, originalItemId: line('A').id, exchangeItemId: issued.id, quantity: 1, priceDifference: price - A, accountId: s.till.id },
    });
    return { issued, exchange };
  };
  const one = await old(s.p.SMALL.id, SMALL);
  const two = await old(s.p.PRICIER.id, PRICIER);
  // A line two exchanges point at (the app never wrote one) is left alone.
  const shared = await prisma.orderItem.create({ data: { orderId: order.id, productId: s.p.CHEAPER.id, quantity: 1, price: CHEAPER } });
  for (let i = 0; i < 2; i++) {
    await prisma.orderExchange.create({
      data: { orderId: order.id, originalItemId: line('A').id, exchangeItemId: shared.id, quantity: 0, priceDifference: 0, accountId: s.till.id },
    });
  }

  const before = readInvoice(await render(PrintOrderPage({ params: { id: order.id } })));
  const marks = async () =>
    (await prisma.orderItem.findMany({ where: { orderId: order.id }, orderBy: { id: 'asc' } })).map((i: any) => [i.id, i.exchangeId]);

  await prisma.$executeRawUnsafe(sql('backfill-order-exchange-items.sql'));
  const first = await marks();
  assert.deepEqual(first, [
    [line('A').id, null],
    [one.issued.id, one.exchange.id],
    [two.issued.id, two.exchange.id],
    [shared.id, null],
  ]);
  await prisma.$executeRawUnsafe(sql('backfill-order-exchange-items.sql'));
  assert.deepEqual(await marks(), first);

  const after = readInvoice(await render(PrintOrderPage({ params: { id: order.id } })));
  assert.deepEqual(after, before);
});

test('the pre-push SQL creates the exchange columns as Prisma defines them, and can run twice', async () => {
  const catalog = async () => ({
    columns: (await prisma.$queryRawUnsafe(
      `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
       WHERE (table_name, column_name) IN (('OrderItem', 'exchangeId'), ('OrderExchange', 'clientRequestId')) ORDER BY table_name`,
    )) as any[],
    indexes: (await prisma.$queryRawUnsafe(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE indexname IN ('OrderItem_exchangeId_idx', 'OrderExchange_clientRequestId_key') ORDER BY indexname`,
    )) as any[],
    foreignKeys: (await prisma.$queryRawUnsafe(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'OrderItem_exchangeId_fkey'`,
    )) as any[],
  });
  const expected = {
    columns: [
      { table_name: 'OrderExchange', column_name: 'clientRequestId', data_type: 'text', is_nullable: 'YES' },
      { table_name: 'OrderItem', column_name: 'exchangeId', data_type: 'text', is_nullable: 'YES' },
    ],
    indexes: [
      { indexname: 'OrderExchange_clientRequestId_key', indexdef: 'CREATE UNIQUE INDEX "OrderExchange_clientRequestId_key" ON public."OrderExchange" USING btree ("clientRequestId")' },
      { indexname: 'OrderItem_exchangeId_idx', indexdef: 'CREATE INDEX "OrderItem_exchangeId_idx" ON public."OrderItem" USING btree ("exchangeId")' },
    ],
    foreignKeys: [
      { conname: 'OrderItem_exchangeId_fkey', def: 'FOREIGN KEY ("exchangeId") REFERENCES "OrderExchange"(id) ON UPDATE CASCADE ON DELETE SET NULL' },
    ],
  };
  const prePush = () => prisma.$executeRawUnsafe(sql('pre-push-unique-columns.sql'));

  // On a database that already has them (as db push left it): nothing changes, twice.
  await prePush();
  await prePush();
  assert.deepEqual(await catalog(), expected);

  // On one from before them (the deploy that adds them): created, then left alone.
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_exchangeId_fkey"`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "OrderItem" DROP COLUMN "exchangeId"`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "OrderExchange" DROP COLUMN "clientRequestId"`);
    assert.deepEqual(await catalog(), { columns: [], indexes: [], foreignKeys: [] });
    await prePush();
    assert.deepEqual(await catalog(), expected);
    await prePush();
    assert.deepEqual(await catalog(), expected);
  } finally {
    // Leave the test database as db push made it, whatever happened above.
    await prePush();
  }
});

test('the pre-push SQL creates CustomerCredit exactly as db push does, and can run twice', async () => {
  // The table, its columns, indexes and constraints, as the catalog describes them.
  const catalog = async () => ({
    columns: (await prisma.$queryRawUnsafe(
      `SELECT column_name, data_type, numeric_precision, numeric_scale, datetime_precision, is_nullable, column_default
       FROM information_schema.columns WHERE table_name = 'CustomerCredit' ORDER BY ordinal_position`,
    )) as any[],
    indexes: (await prisma.$queryRawUnsafe(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'CustomerCredit' ORDER BY indexname`,
    )) as any[],
    constraints: (await prisma.$queryRawUnsafe(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = to_regclass('"CustomerCredit"') ORDER BY conname`,
    )) as any[],
  });
  const prePush = () => prisma.$executeRawUnsafe(sql('pre-push-unique-columns.sql'));

  // The test database's table was made by db push: that is what the SQL must reproduce.
  const byDbPush = await catalog();
  assert.equal(byDbPush.columns.length, 9);
  assert.deepEqual(byDbPush.indexes.map((i: any) => i.indexname), [
    'CustomerCredit_clientRequestId_key', 'CustomerCredit_customerId_idx', 'CustomerCredit_exchangeId_idx',
    'CustomerCredit_orderId_idx', 'CustomerCredit_pkey',
  ]);
  assert.deepEqual(byDbPush.constraints.map((c: any) => c.def), [
    'FOREIGN KEY ("customerId") REFERENCES "Customer"(id) ON UPDATE CASCADE ON DELETE RESTRICT',
    'FOREIGN KEY ("exchangeId") REFERENCES "OrderExchange"(id) ON UPDATE CASCADE ON DELETE SET NULL',
    'FOREIGN KEY ("orderId") REFERENCES "Order"(id) ON UPDATE CASCADE ON DELETE SET NULL',
    'PRIMARY KEY (id)',
  ]);

  // Where it exists, nothing changes.
  await prePush();
  await prePush();
  assert.deepEqual(await catalog(), byDbPush);

  // Where it does not yet (the deploy that adds it): created as db push would, then left alone.
  try {
    await prisma.$executeRawUnsafe(`DROP TABLE "CustomerCredit"`);
    assert.deepEqual(await catalog(), { columns: [], indexes: [], constraints: [] });
    await prePush();
    assert.deepEqual(await catalog(), byDbPush);
    await prePush();
    assert.deepEqual(await catalog(), byDbPush);
  } finally {
    // Leave the test database with the table, whatever happened above.
    await prePush();
  }
});

test('the read-only reports list over-paid orders and orders whose totals predate b78d364', async () => {
  const s = await shop();
  // Over-paid: a cheaper exchange whose difference stayed on the order.
  const kept = await sell(s, [['A', 1]], 0, A);
  await swap(s, kept.order.id, kept.line('A').id, 'CHEAPER', 1);
  // Not over-paid: an old WooCommerce order paid its total, which is already after its discount.
  await prisma.order.create({ data: { customerId: s.customer.id, wooId: 11, totalAmount: 900_000, discount: 100_000, paidAmount: 900_000 } });
  // A return booked the old way (before b78d364): cash back, total untouched.
  const legacy = await sell(s, [['A', 2]], 0, 2 * A);
  await prisma.orderReturn.create({
    data: { orderId: legacy.order.id, orderItemId: legacy.line('A').id, quantity: 1, refundAmount: A, accountId: s.till.id, createdAt: new Date('2026-05-01T10:00:00Z') },
  });
  // A return booked since: the total followed it.
  const current = await sell(s, [['A', 2]], 0, 2 * A);
  await giveBack(s, current.order.id, current.line('A').id, 1);

  const overpaid: any[] = await prisma.$queryRawUnsafe(sql('report-legacy-overpaid-orders.sql'));
  assert.deepEqual(
    overpaid.map((r) => [r.order_number, Number(r.overpaid), r.likely_cause]),
    [[kept.order.number, 300_000, 'cheaper exchange kept on the order']],
  );
  const totals: any[] = await prisma.$queryRawUnsafe(sql('report-legacy-return-totals.sql'));
  assert.deepEqual(
    totals.map((r) => [r.order_number, Number(r.stored_total), Number(r.lines_still_sold), r.booked_before_b78d364]),
    [[legacy.order.number, 2 * A, A, true]],
  );
  // Read-only: nothing changed.
  assert.deepEqual(await orderRow(legacy.order.id), { total: 2 * A, discount: 0, paid: 2 * A, status: 'PAID' });
});
