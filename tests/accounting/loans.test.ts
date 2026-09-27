import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { createLoan, getLoanById, getLoans, recordLoanPayment } from '@/actions/loan';
import { assertBooksAddUp, balanceOf, openAccount } from './ledger';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

let sara: { id: string };

beforeEach(async () => {
  setTestRole('ADMIN');
  beforeQuery.fn = null;
  await resetDatabase();
  await openAccount('bank', 100_000_000);
  sara = await prisma.employee.create({ data: { name: 'سارا', salary: 1 } });
});
after(() => prisma.$disconnect());

/** remaining = amount − the principal repaid, never below 0, and the status follows it. */
async function assertLoansAddUp() {
  for (const loan of await prisma.loan.findMany({ include: { payments: true } })) {
    const repaid = loan.payments.reduce((sum: number, p: any) => sum + Number(p.principal), 0);
    assert.equal(Number(loan.remaining), Number(loan.amount) - repaid);
    assert.ok(Number(loan.remaining) >= 0);
    assert.equal(loan.status, Number(loan.remaining) <= 0 ? 'PAID' : 'ACTIVE');
  }
  await assertBooksAddUp();
}

async function lend(amount = '5000000', extra: Record<string, string> = {}) {
  const lent = await createLoan(undefined, form({ borrowerId: sara.id, amount, accountId: 'bank', ...extra }));
  assert.equal(lent.success, true, lent.message);
  return prisma.loan.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
}

const repay = (loanId: string, amount: string, extra: Record<string, string> = {}) =>
  recordLoanPayment(undefined, form({ loanId, amount, accountId: 'bank', ...extra }));

test('a loan is a Loan row and one EXPENSE row off the paying account', async () => {
  const loan = await lend('5000000', { interestRate: '4.5', description: 'خرید لپ‌تاپ', dueDate: '2027-03-20T20:30:00.000Z' });
  assert.deepEqual(
    [Number(loan.amount), Number(loan.remaining), Number(loan.interestRate), loan.description, loan.dueDate?.toISOString(), loan.status, loan.employeeId],
    [5_000_000, 5_000_000, 4.5, 'خرید لپ‌تاپ', '2027-03-20T20:30:00.000Z', 'ACTIVE', sara.id],
  );
  const row = await prisma.transaction.findFirstOrThrow({ where: { category: 'قرض به کارمند' } });
  assert.deepEqual(
    [row.type, Number(row.amount), Number(row.amountInToman), row.accountId, row.employeeId, row.description],
    ['EXPENSE', 5_000_000, 5_000_000, 'bank', sara.id, 'قرض - سارا: خرید لپ‌تاپ'],
  );
  assert.equal(await balanceOf('bank'), 95_000_000);
  await assertLoansAddUp();
});

test('a loan paid from a dollar account moves the Toman amount in dollars', async () => {
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 100_000, date: new Date('2026-09-20') } });
  await openAccount('usd', 1_000, 'USD');
  const lent = await createLoan(undefined, form({ borrowerId: sara.id, amount: '20000000', accountId: 'usd' }));
  assert.equal(lent.success, true, lent.message);
  assert.equal(await balanceOf('usd'), 800);
  assert.equal(Number((await prisma.loan.findFirstOrThrow()).remaining), 20_000_000, 'the loan itself is kept in Toman');
  await assertLoansAddUp();
});

test('a loan is refused for an unknown employee or account, a balance that cannot cover it, a bad amount or rate', async () => {
  await openAccount('usd-no-rate', 1_000, 'USD');
  const cases: [Record<string, string>, RegExp][] = [
    [{ borrowerId: 'nobody' }, /کارمند یافت نشد/],
    [{ accountId: 'nowhere' }, /حساب یافت نشد/],
    [{ amount: '100000001' }, /کافی نیست/],
    [{ accountId: 'usd-no-rate' }, /نرخ تبدیل/],
    [{ amount: '0' }, /فیلدهای الزامی/],
    [{ amount: '-100' }, /فیلدهای الزامی/],
    [{ interestRate: '101' }, /فیلدهای الزامی/],
    [{ interestRate: '-1' }, /فیلدهای الزامی/],
    [{ borrowerId: '' }, /فیلدهای الزامی/],
  ];
  for (const [fields, message] of cases) {
    const result = await createLoan(undefined, form({ borrowerId: sara.id, amount: '5000000', accountId: 'bank', ...fields }));
    assert.equal(result.success, false, JSON.stringify(fields));
    assert.match(result.message!, message, JSON.stringify(fields));
  }
  assert.equal(await prisma.loan.count(), 0);
  assert.equal(await prisma.transaction.count({ where: { NOT: { category: 'موجودی اولیه' } } }), 0);
  assert.equal(await balanceOf('bank'), 100_000_000);
});

test('a loan and its repayment typed in Persian digits are read as the numbers they are', async () => {
  const lent = await createLoan(undefined, form({ borrowerId: sara.id, amount: '۵٬۰۰۰٬۰۰۰', accountId: 'bank', interestRate: '۴٫۵' }));
  assert.equal(lent.success, true, lent.message);
  const loan = await prisma.loan.findFirstOrThrow();
  assert.deepEqual([Number(loan.amount), Number(loan.interestRate)], [5_000_000, 4.5]);
  const paid = await recordLoanPayment(undefined, form({ loanId: loan.id, amount: '۱۱۰۰۰۰۰', principal: '۱۰۰۰۰۰۰', interest: '١٠٠٠٠٠', accountId: 'bank' }));
  assert.equal(paid.success, true, paid.message);
  assert.equal(Number((await prisma.loan.findFirstOrThrow()).remaining), 4_000_000);
  assert.equal(await balanceOf('bank'), 96_100_000);
  await assertLoansAddUp();
});

test('repaying part, then the rest: each repayment is an INCOME row and a payment record; the loan ends PAID', async () => {
  const loan = await lend();
  const part = await repay(loan.id, '2000000', { date: '2026-10-01T20:30:00.000Z', description: 'قسط مهر' });
  assert.equal(part.success, true, part.message);
  let now = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
  assert.deepEqual([Number(now.remaining), now.status], [3_000_000, 'ACTIVE']);
  const row = await prisma.transaction.findFirstOrThrow({ where: { category: 'Loan Payment' }, include: { LoanPayment: true } });
  assert.deepEqual(
    [row.type, Number(row.amount), Number(row.amountInToman), row.accountId, row.employeeId, row.description, row.date.toISOString()],
    ['INCOME', 2_000_000, 2_000_000, 'bank', null, 'قسط مهر', '2026-10-01T20:30:00.000Z'],
  );
  assert.deepEqual(
    [Number(row.LoanPayment!.amount), Number(row.LoanPayment!.principal), Number(row.LoanPayment!.interest), row.LoanPayment!.loanId],
    [2_000_000, 2_000_000, 0, loan.id],
  );
  assert.equal(await balanceOf('bank'), 97_000_000);

  assert.equal((await repay(loan.id, '3000000')).success, true);
  now = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
  assert.deepEqual([Number(now.remaining), now.status], [0, 'PAID']);
  assert.equal(await balanceOf('bank'), 100_000_000);
  await assertLoansAddUp();
});

test('a repayment split into principal and interest takes only the principal off the loan', async () => {
  const loan = await lend();
  const paid = await repay(loan.id, '1100000', { principal: '1000000', interest: '100000' });
  assert.equal(paid.success, true, paid.message);
  assert.equal(Number((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).remaining), 4_000_000);
  assert.equal(await balanceOf('bank'), 96_100_000);
  await assertLoansAddUp();
});

test('a repayment above what is left, of an unknown loan or into an unknown account, or whose parts do not add up, is refused', async () => {
  const loan = await lend();
  const cases: [string, Record<string, string>, RegExp][] = [
    [loan.id, { amount: '5000001' }, /بیشتر از باقیمانده/],
    ['nobody', {}, /قرض یافت نشد/],
    [loan.id, { accountId: 'nowhere' }, /حساب یافت نشد/],
    [loan.id, { principal: '1000000', interest: '0' }, /اصل به‌علاوه بهره/],
    [loan.id, { principal: '3000000' }, /اصل به‌علاوه بهره/],
    [loan.id, { amount: '0' }, /فیلدهای الزامی/],
    [loan.id, { principal: '-1' }, /فیلدهای الزامی/],
  ];
  const before = await prisma.transaction.count();
  for (const [loanId, fields, message] of cases) {
    const result = await recordLoanPayment(undefined, form({ loanId, amount: '2000000', accountId: 'bank', ...fields }));
    assert.equal(result.success, false, JSON.stringify(fields));
    assert.match(result.message!, message, JSON.stringify(fields));
  }
  assert.equal(await prisma.transaction.count(), before);
  assert.equal(await prisma.loanPayment.count(), 0);
  assert.equal(Number((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).remaining), 5_000_000);
  await assertLoansAddUp();
});

test('two repayments of the same loan at the same moment never take it below zero', async () => {
  const loan = await lend();
  let second = null as Promise<any> | null;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Transaction' || params.action !== 'create') return;
    beforeQuery.fn = null;
    second = repay(loan.id, '3000000');
    await Promise.race([second, sleep(500)]);
  };
  const first = await repay(loan.id, '3000000');
  beforeQuery.fn = null;
  assert.ok(second, 'the second repayment was started');
  const other = await second!;

  assert.deepEqual([first.success, other.success].sort(), [false, true]);
  assert.equal(Number((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).remaining), 2_000_000);
  assert.equal(await balanceOf('bank'), 98_000_000);
  await assertLoansAddUp();
});

test('the loans list filters by status; one loan comes with its payments, their account and row', async () => {
  const open = await lend('5000000');
  const done = await lend('1000000');
  assert.equal((await repay(done.id, '1000000')).success, true);
  assert.equal((await repay(open.id, '500000')).success, true);

  assert.deepEqual((await getLoans('ACTIVE')).map((l: any) => l.id), [open.id]);
  assert.deepEqual((await getLoans('PAID')).map((l: any) => l.id), [done.id]);
  assert.equal((await getLoans()).length, 2);

  const one = await getLoanById(open.id);
  assert.deepEqual([one!.amount, one!.remaining, one!.employee.name], [5_000_000, 4_500_000, 'سارا']);
  assert.equal(one!.payments[0].account.name, 'حساب bank');
  assert.equal(one!.payments[0].transaction!.category, 'Loan Payment');
  assert.equal(await getLoanById('nobody'), undefined);
});
