import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getProfitLossReport } from '@/actions/reports';
import { getExpenseBreakdown, getTransactions, payEmployeeDebt, recordDeposit, recordExpense, recordInternalTransfer } from '@/actions/accounting';
import { exchangeCurrency } from '@/actions/currency-exchange';
import { createLoan, recordLoanPayment } from '@/actions/loan';
import { depositShareholderFunds, withdrawShareholderFunds } from '@/actions/shareholder';
import { calculateShareholderProfits, getShareholderProfits, withdrawShareholderProfit } from '@/actions/shareholder-profit';
import { POST } from '@/app/api/erp/route';
import { isNonOperating } from '@/lib/profit-rows';
import { assertBooksAddUp, openAccount } from './ledger';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const FROM = new Date('2026-01-01T00:00:00Z');
const TO = new Date('2027-12-31T23:59:59Z');
const API_TOKEN = 'profit-loss-test-token';

beforeEach(async () => {
  setTestRole('ADMIN');
  process.env.ERP_API_SECRET = API_TOKEN;
  await resetDatabase();
  await seed();
});
after(() => prisma.$disconnect());

let employeeId: string;
let shareholderId: string;

async function seed() {
  await openAccount('bank', 200_000_000);
  await openAccount('saman', 20_000_000);
  await openAccount('usd', 1_000, 'USD');
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 100_000, date: new Date('2026-09-20T08:00:00Z') } });
  employeeId = (await prisma.employee.create({ data: { name: 'Sara', salary: 1 } })).id;
  shareholderId = (await prisma.shareholder.create({ data: { name: 'Ali', percentage: 100 } })).id;
}

const ok = (result: { success?: boolean; message?: string }) => assert.equal(result.success, true, result.message);

/** Each kind of money that is not trading, booked through the screen (or the API) that books it. */
const NON_TRADING: [string, () => Promise<void>][] = [
  ['a capital deposit', async () =>
    ok(await depositShareholderFunds(undefined, form({ shareholderId, accountId: 'bank', amount: '50000000', currency: 'TOMAN', date: '2026-09-10' })))],
  ['a capital withdrawal', async () =>
    ok(await withdrawShareholderFunds(undefined, form({ shareholderId, accountId: 'bank', amount: '5000000', currency: 'TOMAN', date: '2026-09-11' })))],
  ['a capital deposit in dollars', async () =>
    ok(await depositShareholderFunds(undefined, form({ shareholderId, accountId: 'usd', amount: '100', currency: 'USD', date: '2026-09-11' })))],
  ['a profit paid out to a shareholder', async () => {
    const profit = await prisma.shareholderProfit.create({
      data: { shareholderId, amount: 4_000_000, periodStart: new Date('2025-01-01'), periodEnd: new Date('2025-12-31') },
    });
    ok(await withdrawShareholderProfit(undefined, form({ profitId: profit.id, amount: '4000000', accountId: 'bank', date: '2026-09-12' })));
  }],
  ['a loan paid to an employee', async () =>
    ok(await createLoan(undefined, form({ borrowerId: employeeId, amount: '3000000', accountId: 'bank' })))],
  ['a loan repayment', async () => {
    const loan = await prisma.loan.create({ data: { employeeId, amount: 3_000_000, remaining: 3_000_000 } });
    ok(await recordLoanPayment(undefined, form({ loanId: loan.id, amount: '1000000', accountId: 'bank', date: '2026-09-13' })));
  }],
  ['buying dollars', async () =>
    ok(await exchangeCurrency(undefined, form({
      sourceAccountId: 'bank', targetAccountId: 'usd', sourceAmount: '10000000', targetAmount: '100',
      sourceCurrency: 'TOMAN', targetCurrency: 'USD', exchangeRate: '100000', date: '2026-09-14', description: '',
    })))],
  ['selling dollars at a different rate', async () =>
    ok(await exchangeCurrency(undefined, form({
      sourceAccountId: 'usd', targetAccountId: 'bank', sourceAmount: '50', targetAmount: '5500000',
      sourceCurrency: 'USD', targetCurrency: 'TOMAN', exchangeRate: '110000', date: '2026-09-15', description: '',
    })))],
  ['a transfer between two of our accounts', async () =>
    ok(await recordInternalTransfer(undefined, form({ amount: '7000000', fromAccountId: 'bank', toAccountId: 'saman', date: '2026-09-16' })))],
  ['a transfer booked through the API (its incoming leg is an INCOME row)', async () => {
    const res = await POST(new NextRequest('http://localhost/api/erp', {
      method: 'POST',
      headers: { authorization: `Bearer ${API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'transfer', fromAccountId: 'bank', toAccountId: 'saman', amount: 2_000_000, description: 'انتقال' }),
    }));
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  }],
  ['repaying what an employee paid out of pocket', async () => {
    // The expense itself (a real cost) is booked here without an account; only its repayment is under test.
    await prisma.transaction.create({
      data: { type: 'EXPENSE', amount: 900_000, amountInToman: 900_000, currency: 'TOMAN', employeeId, category: 'اداری', date: new Date('2026-09-01') },
    });
    ok(await payEmployeeDebt(undefined, form({ employeeId, amount: '900000', accountId: 'bank', date: '2026-09-17' })));
    await prisma.transaction.deleteMany({ where: { category: 'اداری' } });
  }],
];

for (const [kind, book] of NON_TRADING) {
  test(`${kind} is neither revenue nor expense; it stays in the journal`, async () => {
    const before = await prisma.transaction.count();
    await book();
    const rows = await prisma.transaction.findMany({ where: { NOT: { category: 'موجودی اولیه' } } });
    assert.ok(rows.length > 0 && (await prisma.transaction.count()) > before, 'the money was booked');
    assert.ok(rows.every((row: any) => isNonOperating(row)), `every row it booked is non-trading: ${rows.map((r: any) => r.category)}`);

    const report = await getProfitLossReport(FROM, TO);
    assert.deepEqual(report.summary, { income: 0, expenses: 0, netProfit: 0, profitMargin: 0 });
    assert.deepEqual(report.incomeByCategory, {});
    assert.deepEqual(report.expensesByCategory, {});
    // Months with only opening balances (ADJUSTMENT rows) show as zero.
    assert.ok(report.monthlyTrend.every((m: any) => m.income === 0 && m.expenses === 0), JSON.stringify(report.monthlyTrend));

    const journal = await getTransactions();
    for (const row of rows) assert.ok(journal.some((t: any) => t.id === row.id), 'the row is still in the journal');
    await assertBooksAddUp();
  });
}

test('beside all of them, profit is the sales less the real costs, by category and by month', async () => {
  for (const [, book] of NON_TRADING) await book();
  // Trading: a sale, rent, a dollar subscription, and a cost an employee paid out of pocket.
  ok(await recordDeposit(undefined, form({ amount: '12000000', currency: 'TOMAN', accountId: 'bank', description: 'فروش', category: 'Sales', date: '2026-09-18' })));
  ok(await recordExpense(undefined, form({ amount: '2000000', currency: 'TOMAN', category: 'اجاره', accountId: 'bank', date: '2026-09-19' })));
  ok(await recordExpense(undefined, form({ amount: '3', currency: 'USD', category: 'اشتراک', accountId: 'usd', date: '2026-10-02' })));
  ok(await recordExpense(undefined, form({ amount: '700000', currency: 'TOMAN', category: 'پیک', employeeId, date: '2026-09-19' })));
  await prisma.transaction.create({ data: { type: 'INCOME', amount: 100_000, amountInToman: 100_000, date: new Date('2026-09-20') } });

  const report = await getProfitLossReport(FROM, TO);
  assert.deepEqual(report.summary, {
    income: 12_100_000,
    expenses: 2_000_000 + 300_000 + 700_000,
    netProfit: 9_100_000,
    profitMargin: (9_100_000 / 12_100_000) * 100,
  });
  assert.deepEqual(report.incomeByCategory, { Sales: 12_000_000, 'سایر': 100_000 });
  assert.deepEqual(report.expensesByCategory, { 'اجاره': 2_000_000, 'اشتراک': 300_000, 'پیک': 700_000 });
  assert.deepEqual(report.monthlyTrend, [
    { month: '2026-09', income: 12_100_000, expenses: 2_700_000, profit: 9_400_000 },
    { month: '2026-10', income: 0, expenses: 300_000, profit: -300_000 },
  ]);
  await assertBooksAddUp();
});

test('rows recorded before the legs were linked are still left out', async () => {
  const row = (data: Record<string, unknown>) =>
    prisma.transaction.create({ data: { amount: 1_000_000, amountInToman: 1_000_000, currency: 'TOMAN', date: new Date('2026-09-10'), ...data } as any });
  await row({ type: 'EXPENSE', category: 'Currency Exchange', accountId: 'bank' });
  await row({ type: 'INCOME', category: 'Currency Exchange', accountId: 'usd', currency: 'USD', amount: 10 });
  await row({ type: 'INCOME', category: 'انتقال داخلی', accountId: 'saman' });
  await row({ type: 'TRANSFER', category: 'انتقال وجه', accountId: 'bank', description: '[خروج] انتقال قدیمی' });
  await row({ type: 'INCOME', category: 'Employee Debt Payment', employeeId });
  await row({ type: 'INCOME', category: 'Sales' });

  const report = await getProfitLossReport(FROM, TO);
  assert.deepEqual(report.summary, { income: 1_000_000, expenses: 0, netProfit: 1_000_000, profitMargin: 100 });
});

test('the period bounds are inclusive, and a row outside them is left out', async () => {
  const sale = (date: string) =>
    prisma.transaction.create({ data: { type: 'INCOME', amount: 1_000, amountInToman: 1_000, category: 'Sales', date: new Date(date) } });
  await sale('2026-08-31T23:59:59.999Z');
  await sale('2026-09-01T00:00:00.000Z');
  await sale('2026-09-30T23:59:59.999Z');
  await sale('2026-10-01T00:00:00.000Z');
  const report = await getProfitLossReport(new Date('2026-09-01T00:00:00Z'), new Date('2026-09-30T23:59:59.999Z'));
  assert.equal(report.summary.income, 2_000);
});

test('the shareholders\' profit for a period is the same net profit, split by their shares', async () => {
  await prisma.shareholder.update({ where: { id: shareholderId }, data: { percentage: 60 } });
  const reza = await prisma.shareholder.create({ data: { name: 'Reza', percentage: 40 } });
  for (const [, book] of NON_TRADING) await book();
  // Profit paid out above belongs to an older period; this one has none yet.
  await prisma.shareholderProfit.deleteMany();
  ok(await recordDeposit(undefined, form({ amount: '12000000', currency: 'TOMAN', accountId: 'bank', description: 'فروش', category: 'Sales', date: '2026-09-18' })));
  ok(await recordExpense(undefined, form({ amount: '2000000', currency: 'TOMAN', category: 'اجاره', accountId: 'bank', date: '2026-09-19' })));

  const period = { periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-10-31T00:00:00.000Z' };
  const report = await getProfitLossReport(new Date(period.periodStart), new Date(period.periodEnd));
  assert.equal(report.summary.netProfit, 10_000_000);

  ok(await calculateShareholderProfits(undefined, form(period)));
  const profits = await getShareholderProfits();
  assert.deepEqual(
    profits.map((p: any) => [p.shareholder.name, p.amount]).sort(),
    [['Ali', 6_000_000], ['Reza', 4_000_000]],
  );
  assert.equal(profits.reduce((sum: number, p: any) => sum + p.amount, 0), report.summary.netProfit);
  assert.ok(reza);
});

test('the expense breakdown adds up to the P&L\'s expenses over the same rows', async () => {
  for (const [, book] of NON_TRADING) await book();
  ok(await recordExpense(undefined, form({ amount: '2000000', currency: 'TOMAN', category: 'اجاره', accountId: 'bank', description: 'دفتر' })));
  ok(await recordExpense(undefined, form({ amount: '3', currency: 'USD', category: 'اشتراک', accountId: 'usd' })));
  await prisma.transaction.create({ data: { type: 'EXPENSE', amount: 7_000, amountInToman: 7_000, category: 'COGS' } });

  const breakdown = await getExpenseBreakdown();
  const report = await getProfitLossReport(FROM, TO);
  assert.equal(breakdown.reduce((sum: number, row: any) => sum + row.amount, 0), report.summary.expenses);
  assert.equal(report.summary.expenses, 2_000_000 + 300_000 + 7_000);
});
