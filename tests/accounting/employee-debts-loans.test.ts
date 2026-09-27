import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getEmployeeDebtDetails, getEmployeeDebts } from '@/actions/accounting';
import { createLoan, recordLoanPayment } from '@/actions/loan';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/**
 * The employee debts page lists what the company owes its employees: expenses
 * they paid out of pocket. A loan runs the other way (the employee owes the
 * company, and the loans page tracks what is left of it), so paying one out
 * must not appear there as a debt of the company.
 */
test('a loan paid to an employee is not a debt the company owes that employee', async () => {
  const bank = await prisma.account.create({ data: { name: 'Bank', type: 'BANK', currency: 'TOMAN', balance: 100_000_000 } });
  const employee = await prisma.employee.create({ data: { name: 'Sara', salary: 1 } });

  const lent = await createLoan(undefined, form({ borrowerId: employee.id, amount: '5000000', accountId: bank.id }));
  assert.equal(lent.success, true, lent.message);

  assert.deepEqual(await getEmployeeDebts(), [], 'the loan is listed as money the company owes');
  const details = await getEmployeeDebtDetails(employee.id);
  assert.equal(details!.totalDebt, 0);
  assert.equal(details!.totalExpenses, 0);
  assert.deepEqual(details!.expenseTransactions, []);

  // Repaying the loan does not touch the debts either.
  const loan = await prisma.loan.findFirstOrThrow();
  const repaid = await recordLoanPayment(undefined, form({ loanId: loan.id, amount: '2000000', accountId: bank.id }));
  assert.equal(repaid.success, true, repaid.message);
  assert.deepEqual(await getEmployeeDebts(), []);
});

test('an out-of-pocket expense beside a loan is still the only debt listed', async () => {
  const bank = await prisma.account.create({ data: { name: 'Bank', type: 'BANK', currency: 'TOMAN', balance: 100_000_000 } });
  const employee = await prisma.employee.create({ data: { name: 'Sara', salary: 1 } });
  await prisma.transaction.create({
    data: { type: 'EXPENSE', amount: 700_000, amountInToman: 700_000, currency: 'TOMAN', employeeId: employee.id, category: 'اداری' },
  });
  const lent = await createLoan(undefined, form({ borrowerId: employee.id, amount: '5000000', accountId: bank.id }));
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
