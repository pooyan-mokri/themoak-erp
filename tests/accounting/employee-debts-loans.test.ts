import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getEmployeeDebtDetails, getEmployeeDebts, payEmployeeDebt, recordExpense } from '@/actions/accounting';
import { createLoan, recordLoanPayment } from '@/actions/loan';
import { assertBooksAddUp, balanceOf, openAccount } from './ledger';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
  await openAccount('bank', 100_000_000);
});
after(() => prisma.$disconnect());

const sara = () => prisma.employee.create({ data: { name: 'Sara', salary: 1 } });

/** What Sara paid out of pocket for the company, recorded from the expense form. */
async function outOfPocket(employeeId: string, amount: number, category = 'اداری') {
  const recorded = await recordExpense(undefined, form({ amount: String(amount), currency: 'TOMAN', category, employeeId }));
  assert.equal(recorded.success, true, recorded.message);
}

/**
 * The employee debts page lists what the company owes its employees: expenses
 * they paid out of pocket. A loan runs the other way (the employee owes the
 * company, and the loans page tracks what is left of it), so paying one out
 * must not appear there as a debt of the company.
 */
test('a loan paid to an employee is not a debt the company owes that employee', async () => {
  const employee = await sara();

  const lent = await createLoan(undefined, form({ borrowerId: employee.id, amount: '5000000', accountId: 'bank' }));
  assert.equal(lent.success, true, lent.message);

  assert.deepEqual(await getEmployeeDebts(), [], 'the loan is listed as money the company owes');
  const details = await getEmployeeDebtDetails(employee.id);
  assert.equal(details!.totalDebt, 0);
  assert.equal(details!.totalExpenses, 0);
  assert.deepEqual(details!.expenseTransactions, []);

  // Repaying the loan does not touch the debts either.
  const loan = await prisma.loan.findFirstOrThrow();
  const repaid = await recordLoanPayment(undefined, form({ loanId: loan.id, amount: '2000000', accountId: 'bank' }));
  assert.equal(repaid.success, true, repaid.message);
  assert.deepEqual(await getEmployeeDebts(), []);
  const afterRepayment = await getEmployeeDebtDetails(employee.id);
  assert.equal(afterRepayment!.totalDebt, 0);
  assert.equal(afterRepayment!.totalPayments, 0, 'a loan repayment is not a repayment of a debt');
  assert.deepEqual(afterRepayment!.paymentTransactions, []);
  assert.equal(await balanceOf('bank'), 100_000_000 - 5_000_000 + 2_000_000);
  await assertBooksAddUp();
});

test('an out-of-pocket expense beside a loan is still the only debt listed', async () => {
  const employee = await sara();
  await outOfPocket(employee.id, 700_000);
  const lent = await createLoan(undefined, form({ borrowerId: employee.id, amount: '5000000', accountId: 'bank' }));
  assert.equal(lent.success, true, lent.message);

  const [debt] = await getEmployeeDebts();
  assert.equal(debt.totalDebt, 700_000);
  assert.equal(debt.expenseCount, 1);
  const details = await getEmployeeDebtDetails(employee.id);
  assert.equal(details!.totalDebt, 700_000);
  assert.deepEqual(
    details!.expenseTransactions.map((row: { amount: number }) => row.amount),
    [700_000],
  );
});

test('repaying part of a debt, then the rest, takes it off the list and the money off the account', async () => {
  const employee = await sara();
  await outOfPocket(employee.id, 700_000);
  await outOfPocket(employee.id, 300_000, 'پیک');
  assert.equal(await balanceOf('bank'), 100_000_000, 'an out-of-pocket expense moves no company money');

  const part = await payEmployeeDebt(undefined, form({ employeeId: employee.id, amount: '400000', accountId: 'bank', date: '2026-09-20' }));
  assert.equal(part.success, true, part.message);
  let [debt] = await getEmployeeDebts();
  assert.deepEqual([debt.totalDebt, debt.expenseCount, debt.paymentCount], [600_000, 2, 1]);
  const details = await getEmployeeDebtDetails(employee.id);
  assert.deepEqual([details!.totalExpenses, details!.totalPayments, details!.totalDebt], [1_000_000, 400_000, 600_000]);
  assert.deepEqual(details!.paymentTransactions.map((p: any) => [p.amount, p.account]), [[400_000, 'حساب bank']]);

  const repayment = await prisma.transaction.findFirstOrThrow({ where: { category: 'تسویه بدهی کارمند' } });
  assert.deepEqual(
    [repayment.type, Number(repayment.amount), Number(repayment.amountInToman), repayment.accountId, repayment.employeeId],
    ['EXPENSE', 400_000, 400_000, 'bank', employee.id],
  );
  assert.equal(await balanceOf('bank'), 99_600_000);

  const rest = await payEmployeeDebt(undefined, form({ employeeId: employee.id, amount: '600000', accountId: 'bank' }));
  assert.equal(rest.success, true, rest.message);
  assert.deepEqual(await getEmployeeDebts(), []);
  assert.equal((await getEmployeeDebtDetails(employee.id))!.totalDebt, 0);
  assert.equal(await balanceOf('bank'), 99_000_000);
  await assertBooksAddUp();
});

test('a repayment recorded the old way (an INCOME row) still nets the debt', async () => {
  const employee = await sara();
  await outOfPocket(employee.id, 700_000);
  await prisma.transaction.create({
    data: {
      type: 'INCOME', amount: 200_000, amountInToman: 200_000, currency: 'TOMAN',
      employeeId: employee.id, category: 'Employee Debt Payment', description: 'تسویه قدیمی',
    },
  });
  const [debt] = await getEmployeeDebts();
  assert.equal(debt.totalDebt, 500_000);
});

test('a repayment is refused for an unknown employee or account, an empty balance, or a zero amount', async () => {
  const employee = await sara();
  await outOfPocket(employee.id, 700_000);
  await openAccount('empty', 100_000);
  const before = await prisma.transaction.count();

  const cases: [Record<string, string>, RegExp][] = [
    [{ employeeId: 'nobody', amount: '1000', accountId: 'bank' }, /کارمند یافت نشد/],
    [{ employeeId: employee.id, amount: '1000', accountId: 'nowhere' }, /حساب یافت نشد/],
    [{ employeeId: employee.id, amount: '500000', accountId: 'empty' }, /کافی نیست/],
    [{ employeeId: employee.id, amount: '0', accountId: 'bank' }, /فیلدهای الزامی/],
    [{ employeeId: employee.id, amount: '-5', accountId: 'bank' }, /فیلدهای الزامی/],
    [{ employeeId: employee.id, amount: '۱۰۰۰', accountId: 'bank' }, /فیلدهای الزامی/],
    [{ employeeId: employee.id, amount: '1000', accountId: '' }, /فیلدهای الزامی/],
  ];
  for (const [fields, message] of cases) {
    const result = await payEmployeeDebt(undefined, form(fields));
    assert.equal(result.success, false, JSON.stringify(fields));
    assert.match(result.message!, message, JSON.stringify(fields));
  }
  assert.equal(await prisma.transaction.count(), before);
  assert.equal(await balanceOf('bank'), 100_000_000);
  assert.equal(await balanceOf('empty'), 100_000);
});

test('the debt of a dollar expense is its Toman value, and a Toman repayment from a dollar account moves dollars', async () => {
  const employee = await sara();
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 100_000, date: new Date('2026-09-20') } });
  await openAccount('usd', 1_000, 'USD');
  const recorded = await recordExpense(undefined, form({ amount: '5', currency: 'USD', category: 'اشتراک', employeeId: employee.id }));
  assert.equal(recorded.success, true, recorded.message);
  assert.equal((await getEmployeeDebts())[0].totalDebt, 500_000);

  const paid = await payEmployeeDebt(undefined, form({ employeeId: employee.id, amount: '500000', accountId: 'usd' }));
  assert.equal(paid.success, true, paid.message);
  assert.equal(await balanceOf('usd'), 995);
  assert.deepEqual(await getEmployeeDebts(), []);
  await assertBooksAddUp();
});
