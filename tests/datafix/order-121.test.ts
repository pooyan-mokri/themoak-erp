import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { orderTotals } from '@/lib/order-balance';
import { assertBooksAddUp, openAccount } from '../accounting/ledger';
import { changedTables, rowsHash, runFix, runTwice, tableHashes } from './sql';
import { order121 } from './real-shapes';

// prisma/sql/datafix-2026-10-01-order-121-overpayment.sql: order #121 was paid 16M; the 18M was a recording
// error, which the account's reconciliation of 1405/06/30 had already absorbed.

beforeEach(async () => {
  await resetDatabase();
  await openAccount('saman', 100_000_000);
});
after(() => prisma.$disconnect());

const balance = async () => Number((await prisma.account.findUniqueOrThrow({ where: { id: 'saman' } })).balance);

test('the checkout becomes 16M and the reconciliation 2M smaller: the order PAID, the balance where it was', async () => {
  const { order, checkout, correction } = await order121('saman');
  const before = await balance();
  const others = await rowsHash('Transaction', [checkout.id, correction.id]);
  await assertBooksAddUp();

  await runTwice('datafix-2026-10-01-order-121-overpayment.sql', ['Account', 'Order', 'Transaction']);

  const row = await prisma.transaction.findUniqueOrThrow({ where: { id: checkout.id } });
  assert.deepEqual([Number(row.amount), Number(row.amountInToman)], [16_000_000, 16_000_000]);
  const fixed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.deepEqual([Number(fixed.paidAmount), fixed.paymentStatus], [16_000_000, 'PAID']);
  assert.deepEqual([orderTotals(fixed).remaining, orderTotals(fixed).credit], [0, 0]);
  const reconciled = await prisma.transaction.findUniqueOrThrow({ where: { id: correction.id } });
  assert.deepEqual([Number(reconciled.amount), Number(reconciled.amountInToman)], [430_100, 430_100]);
  assert.match(reconciled.description!, /^تطبیق با بانک ۱۴۰۵\/۰۶\/۳۰: .* — ۲٬۰۰۰٬۰۰۰ از این اصلاح ثبت اشتباه پرداخت سفارش #۱۲۱ بود/);
  assert.equal(await balance(), before);
  await assertBooksAddUp();
  assert.equal(await rowsHash('Transaction', [checkout.id, correction.id]), others);
});

test('on a copy where the earlier form ran (checkout fixed, account 2M down), only the reconciliation is fixed', async () => {
  const { order, checkout, correction } = await order121('saman');
  const before = await balance();
  await prisma.transaction.update({ where: { id: checkout.id }, data: { amount: 16_000_000, amountInToman: 16_000_000 } });
  await prisma.order.update({ where: { id: order.id }, data: { paidAmount: 16_000_000 } });
  await prisma.account.update({ where: { id: 'saman' }, data: { balance: { decrement: 2_000_000 } } });
  await prisma.transaction.create({ data: { type: 'EXPENSE', category: 'COGS', amount: 4_000_000, amountInToman: 4_000_000, orderId: order.id } });
  await assertBooksAddUp();

  await runTwice('datafix-2026-10-01-order-121-overpayment.sql', ['Account', 'Transaction']);

  assert.equal(Number((await prisma.transaction.findUniqueOrThrow({ where: { id: correction.id } })).amount), 430_100);
  assert.equal(Number((await prisma.transaction.findUniqueOrThrow({ where: { id: checkout.id } })).amount), 16_000_000);
  assert.equal(await balance(), before);
  await assertBooksAddUp();
});

test('unless the order and the reconciliation are as described, it stops and changes nothing', async () => {
  const { order, correction } = await order121('saman');
  await prisma.transaction.create({ data: { type: 'INCOME', category: 'Sales', amount: 1_000, amountInToman: 1_000, accountId: 'saman', orderId: order.id } });
  let before = await tableHashes();
  await assert.rejects(runFix('datafix-2026-10-01-order-121-overpayment.sql'), /order-121: not as described .* 2 money rows/);
  assert.deepEqual(changedTables(before, await tableHashes()), []);

  await prisma.transaction.deleteMany({ where: { amount: 1_000 } });
  await prisma.transaction.update({ where: { id: correction.id }, data: { amount: -1_000_000 } });
  before = await tableHashes();
  await assert.rejects(runFix('datafix-2026-10-01-order-121-overpayment.sql'), /expected one «اصلاح موجودی» of −1,569,900 on 1405\/06\/30 on the account, found 1/);
  assert.deepEqual(changedTables(before, await tableHashes()), []);

  await resetDatabase();
  before = await tableHashes();
  await assert.rejects(runFix('datafix-2026-10-01-order-121-overpayment.sql'), /order #121 not found/);
  assert.deepEqual(changedTables(before, await tableHashes()), []);
});
