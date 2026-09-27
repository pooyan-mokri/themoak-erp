import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { adjustAccountBalance, createAccount, payEmployeeDebt, recordDeposit, recordExpense, recordInternalTransfer } from '@/actions/accounting';
import { exchangeCurrency } from '@/actions/currency-exchange';
import { createLoan, recordLoanPayment } from '@/actions/loan';
import { recordPayrollPayment } from '@/actions/payroll';
import { withdrawShareholderProfit } from '@/actions/shareholder-profit';
import { assertBooksAddUp, openAccount } from './ledger';

// The actions log every failure these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  beforeQuery.fn = null;
  await resetDatabase();
  await openAccount('bank', 100_000_000);
  await openAccount('saman', 10_000_000);
  await openAccount('usd', 1_000, 'USD');
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 100_000, date: new Date('2026-09-20') } });
});
after(() => {
  beforeQuery.fn = null;
  return prisma.$disconnect();
});

/** Everything a money action can write. */
async function snapshot() {
  return {
    accounts: (await prisma.account.findMany({ orderBy: { id: 'asc' } })).map((a: any) => [a.id, a.balance.toString()]),
    transactions: await prisma.transaction.count(),
    payrolls: (await prisma.payroll.findMany()).map((p: any) => [p.paidAmount.toString(), p.status]),
    payrollPayments: await prisma.payrollPayment.count(),
    loans: (await prisma.loan.findMany({ orderBy: { id: 'asc' } })).map((l: any) => [l.remaining.toString(), l.status]),
    loanPayments: await prisma.loanPayment.count(),
    profits: (await prisma.shareholderProfit.findMany()).map((p: any) => p.withdrawn.toString()),
    profitPayouts: await prisma.shareholderWithdrawal.count(),
    bankChecks: await prisma.bankCheck.count(),
  };
}

/** Runs `action` with the database failing at the `nth` (1-based) `model.action` query, and returns its result. */
async function failingAt<T>(model: string, action: string, run: () => Promise<T>, nth = 1): Promise<T> {
  let seen = 0;
  beforeQuery.fn = async (params) => {
    if (params.model === model && params.action === action && ++seen === nth) throw new Error('the database went away');
  };
  try {
    return await run();
  } finally {
    beforeQuery.fn = null;
  }
}

test('a failure at any step of a money action leaves nothing half-written', async () => {
  const sara = await prisma.employee.create({ data: { name: 'سارا', salary: 1 } });
  const ali = await prisma.shareholder.create({ data: { name: 'علی', percentage: 100 } });
  const payslip = await prisma.payroll.create({ data: { employeeId: sara.id, amount: 3_000_000, netAmount: 3_000_000, periodMonth: 7, periodYear: 1405 } });
  const loan = await prisma.loan.create({ data: { employeeId: sara.id, amount: 2_000_000, remaining: 2_000_000 } });
  const profit = await prisma.shareholderProfit.create({
    data: { shareholderId: ali.id, amount: 900_000, periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-01-31') },
  });
  await prisma.transaction.create({ data: { type: 'EXPENSE', amount: 400_000, amountInToman: 400_000, employeeId: sara.id, category: 'پیک' } });

  const cases: [string, string, string, () => Promise<{ success?: boolean }>, number?][] = [
    ['salary: the payment record', 'PayrollPayment', 'create', () => recordPayrollPayment(undefined, form({ payrollId: payslip.id, amount: '1000000', accountId: 'bank' }))],
    ['salary: the balance', 'Account', 'update', () => recordPayrollPayment(undefined, form({ payrollId: payslip.id, amount: '1000000', accountId: 'bank' }))],
    ['loan: the balance', 'Account', 'update', () => createLoan(undefined, form({ borrowerId: sara.id, amount: '500000', accountId: 'bank' }))],
    ['repayment: the loan', 'Loan', 'update', () => recordLoanPayment(undefined, form({ loanId: loan.id, amount: '300000', accountId: 'bank' }))],
    ['profit payout: the profit', 'ShareholderProfit', 'update', () => withdrawShareholderProfit(undefined, form({ profitId: profit.id, amount: '600000', accountId: 'bank' }))],
    ['debt repayment: the balance', 'Account', 'update', () => payEmployeeDebt(undefined, form({ employeeId: sara.id, amount: '400000', accountId: 'bank' }))],
    ['transfer: the second leg', 'Transaction', 'create', () => recordInternalTransfer(undefined, form({ amount: '1000000', fromAccountId: 'bank', toAccountId: 'saman' })), 2],
    ['transfer: the second balance', 'Account', 'update', () => recordInternalTransfer(undefined, form({ amount: '1000000', fromAccountId: 'bank', toAccountId: 'saman' })), 2],
    ['exchange: the second balance', 'Account', 'update', () => exchangeCurrency(undefined, form({
      sourceAccountId: 'bank', targetAccountId: 'usd', sourceAmount: '1000000', targetAmount: '10',
      sourceCurrency: 'TOMAN', targetCurrency: 'USD', exchangeRate: '100000', date: '2026-09-21', description: '',
    })), 2],
    ['expense: the balance', 'Account', 'update', () => recordExpense(undefined, form({ amount: '1000', currency: 'TOMAN', category: 'اداری', accountId: 'bank' }))],
    ['deposit: the balance', 'Account', 'update', () => recordDeposit(undefined, form({ amount: '1000', currency: 'TOMAN', accountId: 'bank', description: 'واریز' }))],
    ['new account: its opening row', 'Transaction', 'create', () => createAccount(undefined, form({ name: 'ملت', type: 'BANK', currency: 'TOMAN', initialBalance: '5000' }))],
    ['correction: the balance', 'Account', 'update', () => adjustAccountBalance({ accountId: 'bank', targetBalance: 90_000_000 })],
  ];
  for (const [name, model, action, run, nth] of cases) {
    const before = await snapshot();
    const result = await failingAt(model, action, run, nth);
    assert.notEqual(result.success, true, name);
    assert.deepEqual(await snapshot(), before, `${name} left something behind`);
  }
  await assertBooksAddUp();
});
