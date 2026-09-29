import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getTransactions } from '@/actions/accounting';
import { JOURNAL_MAX_ROWS, journalTotals, typeLabel } from '@/lib/journal-export';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

async function row(date: string, description: string) {
  await prisma.transaction.create({
    data: { type: 'INCOME', amount: 1, amountInToman: 1, date: new Date(date), description },
  });
}

test('the journal reaches any period, however many newer rows there are', async () => {
  await row('2025-03-01T10:00:00Z', 'پارسال');
  // More newer rows than the old 100-row cap, which hid everything behind them.
  await prisma.transaction.createMany({
    data: Array.from({ length: 150 }, (_, i) => ({
      type: 'INCOME' as const,
      amount: 1,
      amountInToman: 1,
      date: new Date(Date.UTC(2026, 8, 1, 0, i)),
      description: `شهریور ${i}`,
    })),
  });

  const all = await getTransactions();
  assert.equal(all.length, 151);
  assert.ok(all.some((t: any) => t.description === 'پارسال'));

  const lastYear = await getTransactions({ from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual(lastYear.map((t: any) => t.description), ['پارسال']);

  // «to» includes the whole of that day.
  const firstOfSeptember = await getTransactions({ from: '2026-09-01', to: '2026-09-01' });
  assert.equal(firstOfSeptember.length, 150);
  assert.ok(JOURNAL_MAX_ROWS >= 1000);
});

test('a sale row shows its customer\'s name, and every amount comes as a number', async () => {
  const customer = await prisma.customer.create({ data: { id: 'ckcustomer0000000000000001', name: 'سارا' } });
  const bank = await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 5_000_000 } });
  const employee = await prisma.employee.create({ data: { name: 'رضا', salary: 30_000_000 } });
  const sale = await prisma.transaction.create({
    data: {
      type: 'INCOME', amount: 5_000_000, amountInToman: 5_000_000, accountId: bank.id, category: 'Sales',
      description: `سفارش فروش - مشتری: ${customer.id}`,
    },
  });
  await prisma.order.create({ data: { totalAmount: 5_000_000, customerId: customer.id, transactionId: sale.id } });
  await prisma.transaction.create({ data: { type: 'EXPENSE', amount: 700_000, amountInToman: 700_000, employeeId: employee.id, category: 'پیک' } });

  const rows = await getTransactions();
  const shown = rows.find((t: any) => t.id === sale.id)!;
  assert.equal(shown.description, 'سفارش فروش - مشتری: سارا');
  assert.deepEqual([shown.amount, shown.amountInToman, shown.rateSnapshot, shown.account!.balance], [5_000_000, 5_000_000, 1, 5_000_000]);
  const paidByEmployee = rows.find((t: any) => t.employeeId === employee.id)!;
  assert.deepEqual([paidByEmployee.account, paidByEmployee.employee!.salary], [undefined, 30_000_000]);
});

test('the journal footer adds income and expense in Toman; transfers and adjustments move neither', () => {
  const row = (type: string, amountInToman: number | string) =>
    ({ date: new Date(), type, amount: 1, currency: 'USD', amountInToman, accountName: 'x' });
  assert.deepEqual(
    journalTotals([row('INCOME', 5_000_000), row('INCOME', '250000.5'), row('EXPENSE', 1_000_000), row('TRANSFER', 9_999), row('ADJUSTMENT', 7_777), row('EXPENSE', 'bad')]),
    { income: 5_250_000.5, expense: 1_000_000, net: 4_250_000.5 },
  );
  assert.deepEqual(['INCOME', 'EXPENSE', 'TRANSFER', 'ADJUSTMENT'].map(typeLabel), ['درآمد', 'هزینه', 'انتقال', 'تعدیل']);
  assert.equal(typeLabel('OTHER'), 'OTHER');
});
