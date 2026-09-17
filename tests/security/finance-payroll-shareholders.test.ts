import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { AccessDenied, ACCESS_DENIED_MESSAGE } from '@/lib/access';
import { createEmployee, deleteEmployee, getEmployeeById, getEmployees, updateEmployee } from '@/actions/employee';
import { createPayroll, getPayrollById, getPayrolls, recordPayrollPayment } from '@/actions/payroll';
import { createLoan, getLoanById, getLoans, recordLoanPayment } from '@/actions/loan';
import { getEmployeeDebtDetails, getEmployeeDebts, payEmployeeDebt } from '@/actions/accounting';
import {
  createShareholder,
  depositShareholderFunds,
  getShareholderBalance,
  getShareholders,
  getShareholdersWithBalance,
  withdrawShareholderFunds,
} from '@/actions/shareholder';
import {
  calculateShareholderProfits,
  getShareholderProfitById,
  getShareholderProfits,
  withdrawShareholderProfit,
} from '@/actions/shareholder-profit';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const SALARY = 41_234_567;

async function rejectsAccess(promise: Promise<unknown>, label: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AccessDenied, label);
    return true;
  });
}

function assertDenied(result: { success?: boolean; message?: string }, label: string) {
  assert.equal(result.success, false, label);
  assert.equal(result.message, ACCESS_DENIED_MESSAGE, label);
}

async function balanceOf(id: string) {
  return Number((await prisma.account.findUniqueOrThrow({ where: { id } })).balance);
}

async function seedPayroll() {
  const bank = await prisma.account.create({ data: { name: 'Bank', type: 'BANK', currency: 'TOMAN', balance: 900_000_000 } });
  const employee = await prisma.employee.create({ data: { name: 'Sara', salary: SALARY } });
  const payroll = await prisma.payroll.create({
    data: { employeeId: employee.id, amount: SALARY, netAmount: SALARY, periodMonth: 1, periodYear: 1405 },
  });
  const loan = await prisma.loan.create({ data: { employeeId: employee.id, amount: 5_000_000, remaining: 5_000_000 } });
  // An out-of-pocket expense the company owes the employee.
  await prisma.transaction.create({
    data: { type: 'EXPENSE', amount: 700_000, amountInToman: 700_000, currency: 'TOMAN', employeeId: employee.id, category: 'اداری' },
  });
  return { bank, employee, payroll, loan };
}

test('payroll reads need payroll.view', async () => {
  const { employee, payroll, loan } = await seedPayroll();
  const reads: [string, () => Promise<unknown>][] = [
    ['getEmployees', () => getEmployees()],
    ['getEmployeeById', () => getEmployeeById(employee.id)],
    ['getPayrolls', () => getPayrolls()],
    ['getPayrollById', () => getPayrollById(payroll.id)],
    ['getLoans', () => getLoans()],
    ['getLoanById', () => getLoanById(loan.id)],
    ['getEmployeeDebts', () => getEmployeeDebts()],
    ['getEmployeeDebtDetails', () => getEmployeeDebtDetails(employee.id)],
  ];
  for (const role of ['SALES', 'WAREHOUSE', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    for (const [name, read] of reads) await rejectsAccess(read(), `${name} / ${role}`);
  }
  for (const role of ['ADMIN', 'AUDITOR', 'ACCOUNTANT']) {
    setTestRole(role);
    assert.equal((await getEmployees())[0].salary, SALARY, role);
    assert.equal((await getPayrolls())[0].netAmount, SALARY, role);
    assert.equal((await getLoans()).length, 1, role);
    assert.equal((await getEmployeeDebts())[0].totalDebt, 700_000, role);
  }
});

test('payroll writes refuse AUDITOR and SALES and change nothing; ACCOUNTANT succeeds', async () => {
  const { bank, employee, payroll, loan } = await seedPayroll();
  const counts = async () => ({
    employees: await prisma.employee.count(),
    payrolls: await prisma.payroll.count(),
    loans: await prisma.loan.count(),
    transactions: await prisma.transaction.count(),
    payrollPayments: await prisma.payrollPayment.count(),
    loanPayments: await prisma.loanPayment.count(),
  });
  const before = await counts();
  const employeeForm = () => form({ name: 'Reza', salary: '1000' });

  for (const role of ['AUDITOR', 'SALES', 'WAREHOUSE', 'USER']) {
    setTestRole(role);
    assertDenied(await createEmployee(undefined, employeeForm()), `createEmployee / ${role}`);
    assertDenied(await updateEmployee(employee.id, undefined, form({ name: 'Hacked', salary: '1' })), `updateEmployee / ${role}`);
    assertDenied(await deleteEmployee(employee.id), `deleteEmployee / ${role}`);
    assertDenied(
      await createPayroll(undefined, form({ employeeId: employee.id, amount: '1000', periodMonth: '2', periodYear: '1405' })),
      `createPayroll / ${role}`,
    );
    assertDenied(
      await recordPayrollPayment(undefined, form({ payrollId: payroll.id, amount: '1000', accountId: bank.id })),
      `recordPayrollPayment / ${role}`,
    );
    assertDenied(await createLoan(undefined, form({ borrowerId: employee.id, amount: '1000', accountId: bank.id })), `createLoan / ${role}`);
    assertDenied(
      await recordLoanPayment(undefined, form({ loanId: loan.id, amount: '1000', accountId: bank.id })),
      `recordLoanPayment / ${role}`,
    );
    assertDenied(
      await payEmployeeDebt(undefined, form({ employeeId: employee.id, amount: '1000', accountId: bank.id })),
      `payEmployeeDebt / ${role}`,
    );
  }
  assert.deepEqual(await counts(), before);
  assert.equal(await balanceOf(bank.id), 900_000_000);
  const stored = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
  assert.equal(stored.name, 'Sara');
  assert.equal(Number(stored.salary), SALARY);

  setTestRole('ACCOUNTANT');
  assert.equal((await createEmployee(undefined, employeeForm())).success, true);
  const paid = await recordPayrollPayment(undefined, form({ payrollId: payroll.id, amount: '1000', accountId: bank.id }));
  assert.equal(paid.success, true, paid.message);
  const lent = await createLoan(undefined, form({ borrowerId: employee.id, amount: '1000', accountId: bank.id }));
  assert.equal(lent.success, true, lent.message);
  const repaid = await payEmployeeDebt(undefined, form({ employeeId: employee.id, amount: '1000', accountId: bank.id }));
  assert.equal(repaid.success, true, repaid.message);
  assert.equal(await balanceOf(bank.id), 900_000_000 - 3000);
});

async function seedShareholders() {
  const bank = await prisma.account.create({ data: { name: 'Bank', type: 'BANK', currency: 'TOMAN', balance: 100_000_000 } });
  const shareholder = await prisma.shareholder.create({ data: { name: 'Ali', percentage: 100 } });
  await prisma.transaction.create({
    data: {
      type: 'INCOME', amount: 2_000_000, amountInToman: 2_000_000, currency: 'TOMAN',
      accountId: bank.id, shareholderId: shareholder.id, category: 'Shareholder Deposit',
    },
  });
  const profit = await prisma.shareholderProfit.create({
    data: { shareholderId: shareholder.id, amount: 8_765_432, periodStart: new Date('2025-01-01'), periodEnd: new Date('2025-01-31') },
  });
  return { bank, shareholder, profit };
}

test('shareholders and balances need finance.view; their profits need profit.view', async () => {
  const { shareholder, profit } = await seedShareholders();
  for (const role of ['SALES', 'WAREHOUSE', 'USER']) {
    setTestRole(role);
    await rejectsAccess(getShareholders(), `getShareholders / ${role}`);
    await rejectsAccess(getShareholdersWithBalance(), `getShareholdersWithBalance / ${role}`);
    await rejectsAccess(getShareholderBalance(shareholder.id), `getShareholderBalance / ${role}`);
  }
  for (const role of ['ACCOUNTANT', 'SALES', 'WAREHOUSE', 'USER']) {
    setTestRole(role);
    await rejectsAccess(getShareholderProfits(), `getShareholderProfits / ${role}`);
    await rejectsAccess(getShareholderProfitById(profit.id), `getShareholderProfitById / ${role}`);
  }

  setTestRole('ACCOUNTANT');
  assert.equal((await getShareholdersWithBalance())[0].balance, 2_000_000);
  setTestRole('AUDITOR');
  assert.equal((await getShareholderProfits())[0].amount, 8_765_432);
  assert.equal((await getShareholdersWithBalance())[0].balance, 2_000_000);
});

test('shareholder money moves need finance.manage, and profit distribution also profit.view', async () => {
  const { bank, shareholder, profit } = await seedShareholders();
  const before = { transactions: await prisma.transaction.count(), profits: await prisma.shareholderProfit.count() };
  const money = () => form({ shareholderId: shareholder.id, accountId: bank.id, amount: '1000', currency: 'TOMAN' });
  const period = () => form({ periodStart: '2025-02-01', periodEnd: '2025-02-28' });
  const payout = () => form({ profitId: profit.id, amount: '1000', accountId: bank.id });

  for (const role of ['AUDITOR', 'SALES', 'WAREHOUSE']) {
    setTestRole(role);
    assertDenied(await createShareholder(undefined, form({ name: 'X', percentage: '0' })), `createShareholder / ${role}`);
    assertDenied(await depositShareholderFunds(undefined, money()), `depositShareholderFunds / ${role}`);
    assertDenied(await withdrawShareholderFunds(undefined, money()), `withdrawShareholderFunds / ${role}`);
  }
  // ACCOUNTANT manages money but may not see profit; AUDITOR sees profit but changes nothing.
  for (const role of ['ACCOUNTANT', 'AUDITOR', 'SALES']) {
    setTestRole(role);
    assertDenied(await calculateShareholderProfits(undefined, period()), `calculateShareholderProfits / ${role}`);
    assertDenied(await withdrawShareholderProfit(undefined, payout()), `withdrawShareholderProfit / ${role}`);
  }
  assert.equal(await prisma.transaction.count(), before.transactions);
  assert.equal(await prisma.shareholderProfit.count(), before.profits);
  assert.equal(await prisma.shareholder.count(), 1);
  assert.equal(await balanceOf(bank.id), 100_000_000);
  assert.equal(Number((await prisma.shareholderProfit.findUniqueOrThrow({ where: { id: profit.id } })).withdrawn), 0);

  setTestRole('ACCOUNTANT');
  const deposited = await depositShareholderFunds(undefined, money());
  assert.equal(deposited.success, true, deposited.message);
  assert.equal(await balanceOf(bank.id), 100_001_000);

  setTestRole('ADMIN');
  const withdrawn = await withdrawShareholderProfit(undefined, payout());
  assert.equal(withdrawn.success, true, withdrawn.message);
  assert.equal(Number((await prisma.shareholderProfit.findUniqueOrThrow({ where: { id: profit.id } })).withdrawn), 1000);
});
