import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { orderTotals } from '@/lib/order-balance';
import { openAccount } from '../accounting/ledger';
import { changedTables, rowsHash, runFix, runTwice, tableHashes } from './sql';
import { order121 } from './real-shapes';

// prisma/sql/datafix-2026-10-01-order-121-overpayment.sql: order #121 was paid 16M; the 18M was a recording error.

beforeEach(async () => {
  await resetDatabase();
  await openAccount('saman', 100_000_000);
});
after(() => prisma.$disconnect());

test('the 18M checkout row becomes 16M, the account 2M lower, the order paid 16M and PAID', async () => {
  const { order, checkout } = await order121('saman');
  const others = await rowsHash('Transaction', [checkout.id]);

  await runTwice('datafix-2026-10-01-order-121-overpayment.sql', ['Account', 'Order', 'Transaction']);

  const row = await prisma.transaction.findUniqueOrThrow({ where: { id: checkout.id } });
  assert.deepEqual([Number(row.amount), Number(row.amountInToman)], [16_000_000, 16_000_000]);
  assert.equal(Number((await prisma.account.findUniqueOrThrow({ where: { id: 'saman' } })).balance), 100_000_000 + 16_000_000);
  const fixed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.deepEqual([Number(fixed.paidAmount), fixed.paymentStatus], [16_000_000, 'PAID']);
  assert.deepEqual([orderTotals(fixed).remaining, orderTotals(fixed).credit], [0, 0]);
  assert.equal(await rowsHash('Transaction', [checkout.id]), others);
});

test('a COGS row booked on the order later does not make it look different on another run', async () => {
  const { order } = await order121('saman');
  await runFix('datafix-2026-10-01-order-121-overpayment.sql');
  await prisma.transaction.create({ data: { type: 'EXPENSE', category: 'COGS', amount: 4_000_000, amountInToman: 4_000_000, orderId: order.id } });
  await runTwice('datafix-2026-10-01-order-121-overpayment.sql', []);
});

test('unless the order is as described, it stops and changes nothing', async () => {
  const { order } = await order121('saman');
  await prisma.transaction.create({ data: { type: 'INCOME', category: 'Sales', amount: 1_000, amountInToman: 1_000, accountId: 'saman', orderId: order.id } });
  const before = await tableHashes();
  await assert.rejects(runFix('datafix-2026-10-01-order-121-overpayment.sql'), /order-121: not as described .* 2 money rows/);
  assert.deepEqual(changedTables(before, await tableHashes()), []);

  await resetDatabase();
  const before2 = await tableHashes();
  await assert.rejects(runFix('datafix-2026-10-01-order-121-overpayment.sql'), /order #121 not found/);
  assert.deepEqual(changedTables(before2, await tableHashes()), []);
});
