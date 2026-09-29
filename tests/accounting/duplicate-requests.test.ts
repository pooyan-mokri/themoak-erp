import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { DUPLICATE_REQUEST_MESSAGE } from '@/lib/request-id';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { payEmployeeDebt, recordDeposit, recordExpense, recordInternalTransfer, recordWithdrawal } from '@/actions/accounting';
import { exchangeCurrency } from '@/actions/currency-exchange';
import { recordPayrollPayment } from '@/actions/payroll';
import { createLoan, recordLoanPayment } from '@/actions/loan';
import { depositShareholderFunds, withdrawShareholderFunds } from '@/actions/shareholder';
import { withdrawShareholderProfit } from '@/actions/shareholder-profit';
import { balanceOf, driftOf, openAccount } from './ledger';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  beforeQuery.fn = null;
  await resetDatabase();
  await openAccount('novin', 10_000_000);
  await openAccount('dehghani', 5_000_000);
  await openAccount('usd', 100, 'USD');
});
after(() => prisma.$disconnect());

const REQUEST = 'lunch-0611-request-1';

/** The lunch of 1405/06/11: «Other - ناهار», 632,200, from اقتصاد نوین. */
const lunch = (requestId?: string, accountId = 'novin') =>
  form({
    amount: '632200',
    currency: 'TOMAN',
    category: 'Other',
    accountId,
    description: 'ناهار',
    date: '2026-09-02',
    ...(requestId ? { requestId } : {}),
  });

const rowsOf = (accountId: string) =>
  prisma.transaction.count({ where: { accountId, type: { not: 'ADJUSTMENT' } } });

test('the same expense submitted twice is booked once, and the repeat is answered as a success', async () => {
  const first = await recordExpense(undefined, lunch(REQUEST));
  assert.equal(first.success, true, first.message);
  const second = await recordExpense(undefined, lunch(REQUEST));
  assert.equal(second.success, true, second.message);
  assert.equal(second.message, DUPLICATE_REQUEST_MESSAGE);

  assert.equal(await rowsOf('novin'), 1);
  assert.equal(await balanceOf('novin'), 10_000_000 - 632_200);
  const row = await prisma.transaction.findFirstOrThrow({ where: { accountId: 'novin', type: 'EXPENSE' } });
  assert.equal(row.clientRequestId, REQUEST);
  assert.equal(await driftOf('novin'), 0);
});

test('a repeat is recognised even when the balance no longer covers a second copy', async () => {
  await prisma.account.update({ where: { id: 'novin' }, data: { balance: 700_000 } });
  await prisma.transaction.updateMany({ where: { accountId: 'novin' }, data: { amount: 700_000, amountInToman: 700_000 } });

  assert.equal((await recordExpense(undefined, lunch(REQUEST))).success, true);
  const repeat = await recordExpense(undefined, lunch(REQUEST));
  assert.equal(repeat.success, true, repeat.message);
  assert.equal(repeat.message, DUPLICATE_REQUEST_MESSAGE);
  assert.equal(await balanceOf('novin'), 700_000 - 632_200);
});

test('two copies arriving at the same moment book one expense', async () => {
  // The second copy arrives while the first is about to write: both pass the
  // first check, and whichever writes second is stopped by the unique id.
  let second = null as Promise<any> | null;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Transaction' || params.action !== 'create') return;
    beforeQuery.fn = null;
    second = recordExpense(undefined, lunch(REQUEST));
    await Promise.race([second, sleep(300)]);
  };
  const first = await recordExpense(undefined, lunch(REQUEST));
  beforeQuery.fn = null;
  assert.ok(second, 'the second copy was sent');
  const repeat = await second!;
  assert.equal(first.success, true, first.message);
  assert.equal(repeat.success, true, repeat.message);
  assert.deepEqual(
    [first.message, repeat.message].sort(),
    ['هزینه با موفقیت ثبت شد.', DUPLICATE_REQUEST_MESSAGE].sort(),
  );
  assert.equal(await rowsOf('novin'), 1);
  assert.equal(await balanceOf('novin'), 10_000_000 - 632_200);
});

test('a new id is a new entry, and a submission without an id is still booked', async () => {
  assert.equal((await recordExpense(undefined, lunch('lunch-request-a'))).success, true);
  assert.equal((await recordExpense(undefined, lunch('lunch-request-b'))).success, true);
  assert.equal((await recordExpense(undefined, lunch())).success, true);
  assert.equal(await rowsOf('novin'), 3);
});

test('an expense paid by an employee is protected the same way', async () => {
  const employee = await prisma.employee.create({ data: { name: 'Sara', salary: 1 } });
  const paid = () =>
    form({ amount: '500000', currency: 'TOMAN', category: 'Office', employeeId: employee.id, requestId: REQUEST });
  assert.equal((await recordExpense(undefined, paid())).success, true);
  assert.equal((await recordExpense(undefined, paid())).message, DUPLICATE_REQUEST_MESSAGE);
  assert.equal(await prisma.transaction.count({ where: { employeeId: employee.id } }), 1);
});

test('a deposit and a payment submitted twice are booked once each', async () => {
  const deposit = () =>
    form({ amount: '3000000', currency: 'TOMAN', accountId: 'novin', description: 'واریز مشتری', requestId: 'deposit-request-1' });
  assert.equal((await recordDeposit(undefined, deposit())).success, true);
  const again = await recordDeposit(undefined, deposit());
  assert.equal(again.success, true);
  assert.equal(again.message, DUPLICATE_REQUEST_MESSAGE);

  const payment = () =>
    form({ amount: '1000000', currency: 'TOMAN', accountId: 'novin', payee: 'تامین‌کننده', requestId: 'payment-request-1' });
  assert.equal((await recordWithdrawal(undefined, payment())).success, true);
  assert.equal((await recordWithdrawal(undefined, payment())).message, DUPLICATE_REQUEST_MESSAGE);

  assert.equal(await rowsOf('novin'), 2);
  assert.equal(await balanceOf('novin'), 10_000_000 + 3_000_000 - 1_000_000);
  assert.equal(await driftOf('novin'), 0);
});

test('a transfer submitted twice moves the money once; the id sits on its outgoing leg', async () => {
  const move = () =>
    form({ amount: '4000000', fromAccountId: 'novin', toAccountId: 'dehghani', requestId: 'transfer-request-1' });
  assert.equal((await recordInternalTransfer(undefined, move())).success, true);
  const again = await recordInternalTransfer(undefined, move());
  assert.equal(again.success, true);
  assert.equal(again.message, DUPLICATE_REQUEST_MESSAGE);

  assert.equal(await prisma.transaction.count({ where: { type: 'TRANSFER' } }), 2);
  assert.equal(await balanceOf('novin'), 6_000_000);
  assert.equal(await balanceOf('dehghani'), 9_000_000);
  const carrier = await prisma.transaction.findUniqueOrThrow({ where: { clientRequestId: 'transfer-request-1' } });
  assert.equal(carrier.accountId, 'novin');
  for (const id of ['novin', 'dehghani']) assert.equal(await driftOf(id), 0);
});

test('an exchange submitted twice is booked once', async () => {
  const buy = () =>
    form({
      sourceAccountId: 'novin',
      targetAccountId: 'usd',
      sourceAmount: '2350000',
      targetAmount: '10',
      sourceCurrency: 'TOMAN',
      targetCurrency: 'USD',
      exchangeRate: '235000',
      date: '2026-09-21',
      description: '',
      requestId: 'exchange-request-1',
    });
  const first = await exchangeCurrency(undefined, buy());
  assert.equal(first.success, true, first.message);
  const again = await exchangeCurrency(undefined, buy());
  assert.equal(again.success, true, again.message);
  assert.equal(again.message, DUPLICATE_REQUEST_MESSAGE);

  assert.equal(await prisma.transaction.count({ where: { category: 'Currency Exchange' } }), 2);
  assert.equal(await balanceOf('novin'), 10_000_000 - 2_350_000);
  assert.equal(await balanceOf('usd'), 110);
  const carrier = await prisma.transaction.findUniqueOrThrow({ where: { clientRequestId: 'exchange-request-1' } });
  assert.equal(carrier.accountId, 'novin', 'the id is on the first leg written');
});

// ─── Payroll, loans, shareholders, employee debts ─────────────────────────────

/** Everything these submissions can write, to compare a repeat against. */
const written = async () => ({
  rows: await prisma.transaction.count(),
  payrollPayments: await prisma.payrollPayment.count(),
  loans: await prisma.loan.count(),
  loanPayments: await prisma.loanPayment.count(),
  profitPayouts: await prisma.shareholderWithdrawal.count(),
  novin: await balanceOf('novin'),
});

test('a salary payment, a loan, a repayment, capital moves, a profit payout and a debt repayment submitted twice book once each', async () => {
  const sara = await prisma.employee.create({ data: { name: 'سارا', salary: 1 } });
  const ali = await prisma.shareholder.create({ data: { name: 'علی', percentage: 100 } });
  const payslip = await prisma.payroll.create({ data: { employeeId: sara.id, amount: 3_000_000, netAmount: 3_000_000, periodMonth: 7, periodYear: 1405 } });
  const loan = await prisma.loan.create({ data: { employeeId: sara.id, amount: 2_000_000, remaining: 2_000_000 } });
  const profit = await prisma.shareholderProfit.create({
    data: { shareholderId: ali.id, amount: 900_000, periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-01-31') },
  });
  await prisma.transaction.create({ data: { type: 'EXPENSE', amount: 400_000, amountInToman: 400_000, employeeId: sara.id, category: 'پیک' } });

  const submissions: [string, () => Promise<{ success?: boolean; message?: string }>][] = [
    ['salary', () => recordPayrollPayment(undefined, form({ payrollId: payslip.id, amount: '1000000', accountId: 'novin', requestId: 'salary-request-01' }))],
    ['loan', () => createLoan(undefined, form({ borrowerId: sara.id, amount: '500000', accountId: 'novin', requestId: 'loan-request-0001' }))],
    ['repayment', () => recordLoanPayment(undefined, form({ loanId: loan.id, amount: '300000', accountId: 'novin', requestId: 'repay-request-001' }))],
    ['capital in', () => depositShareholderFunds(undefined, form({ shareholderId: ali.id, accountId: 'novin', amount: '800000', currency: 'TOMAN', requestId: 'capital-in-00001' }))],
    ['capital out', () => withdrawShareholderFunds(undefined, form({ shareholderId: ali.id, accountId: 'novin', amount: '200000', currency: 'TOMAN', requestId: 'capital-out-0001' }))],
    ['profit payout', () => withdrawShareholderProfit(undefined, form({ profitId: profit.id, amount: '600000', accountId: 'novin', requestId: 'profit-out-00001' }))],
    ['debt repayment', () => payEmployeeDebt(undefined, form({ employeeId: sara.id, amount: '400000', accountId: 'novin', requestId: 'debt-repay-00001' }))],
  ];
  for (const [name, submit] of submissions) {
    const first = await submit();
    assert.equal(first.success, true, `${name}: ${first.message}`);
    const before = await written();
    const repeat = await submit();
    assert.equal(repeat.success, true, name);
    assert.equal(repeat.message, DUPLICATE_REQUEST_MESSAGE, name);
    assert.deepEqual(await written(), before, `${name} was booked twice`);
  }
  // Each first submission is booked, under its id.
  assert.equal(await prisma.transaction.count({ where: { clientRequestId: { not: null } } }), submissions.length);
  assert.equal(Number((await prisma.payroll.findUniqueOrThrow({ where: { id: payslip.id } })).paidAmount), 1_000_000);
  assert.equal(Number((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).remaining), 1_700_000);
  assert.equal(Number((await prisma.shareholderProfit.findUniqueOrThrow({ where: { id: profit.id } })).withdrawn), 600_000);
  assert.equal(await balanceOf('novin'), 10_000_000 - 1_000_000 - 500_000 + 300_000 + 800_000 - 200_000 - 600_000 - 400_000);
  assert.equal(await driftOf('novin'), 0);
});

test('two copies of a salary payment at the same moment pay it once, even when the first pays the payslip off', async () => {
  const sara = await prisma.employee.create({ data: { name: 'سارا', salary: 1 } });
  const payslip = await prisma.payroll.create({ data: { employeeId: sara.id, amount: 3_000_000, netAmount: 3_000_000, periodMonth: 7, periodYear: 1405 } });
  const pay = () => recordPayrollPayment(undefined, form({ payrollId: payslip.id, amount: '3000000', accountId: 'novin', requestId: 'salary-request-02' }));
  let second = null as Promise<any> | null;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Transaction' || params.action !== 'create') return;
    beforeQuery.fn = null;
    second = pay();
    await Promise.race([second, sleep(300)]);
  };
  const first = await pay();
  beforeQuery.fn = null;
  const repeat = await second!;
  assert.deepEqual([first.success, repeat.success], [true, true], `${first.message} / ${repeat.message}`);
  assert.ok([first.message, repeat.message].includes(DUPLICATE_REQUEST_MESSAGE));
  assert.equal(await prisma.payrollPayment.count(), 1);
  assert.equal(await balanceOf('novin'), 7_000_000);
});

test('the payroll, loan, shareholder and debt forms send a request id and renew it after every save', () => {
  for (const name of ['payroll-payment-form', 'loan-form', 'loan-payment-form', 'shareholder-deposit-form', 'shareholder-withdrawal-form', 'pay-debt-dialog']) {
    const code = readFileSync(join(process.cwd(), 'src/components/accounting', `${name}.tsx`), 'utf8');
    assert.match(code, /const \[requestId, renewRequestId\] = useRequestId\(\);/, name);
    assert.match(code, /<RequestIdField value=\{requestId\} \/>/, name);
    assert.match(code, /if \(state\.success\) renewRequestId\(\);/, name);
  }
});
