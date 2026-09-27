import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { createPayroll, recordPayrollPayment, updatePayroll } from '@/actions/payroll';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/** Sara's Mehr payslip: 30,000,000 base, 20,000,000 of it already paid from the bank. */
async function payslip() {
  await prisma.user.create({ data: { id: 'test-user', name: 'Test', email: 'test@example.com', password: 'x' } });
  const employee = await prisma.employee.create({ data: { name: 'سارا', salary: 30_000_000 } });
  const bank = await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 100_000_000 } });
  const created = await createPayroll(undefined, form({ employeeId: employee.id, amount: '30000000', periodMonth: '7', periodYear: '1405' }));
  assert.equal(created.success, true, created.message);
  const payroll = await prisma.payroll.findFirstOrThrow();
  const paid = await recordPayrollPayment(undefined, form({ payrollId: payroll.id, amount: '20000000', accountId: bank.id }));
  assert.equal(paid.success, true, paid.message);
  return { payroll, bank };
}

const money = async () => ({
  rows: await prisma.transaction.count(),
  balance: Number((await prisma.account.findFirstOrThrow()).balance),
  payments: await prisma.payrollPayment.count(),
});

test('an admin adds a sales commission to a payslip; nothing already paid moves', async () => {
  const { payroll } = await payslip();
  const before = await money();

  const edited = await updatePayroll(payroll.id, { amount: 30_000_000, bonuses: 5_000_000, deductions: 1_000_000, description: 'کمیسیون فروش مهر' });
  assert.equal(edited.success, true, edited.message);

  const after = await prisma.payroll.findUniqueOrThrow({ where: { id: payroll.id } });
  assert.deepEqual(
    [Number(after.amount), Number(after.bonuses), Number(after.deductions), Number(after.netAmount), Number(after.paidAmount), after.status, after.description],
    [30_000_000, 5_000_000, 1_000_000, 34_000_000, 20_000_000, 'PARTIAL', 'کمیسیون فروش مهر'],
  );
  assert.deepEqual(await money(), before, 'no money row, no balance, no payment changed');
  assert.equal(await prisma.activityLog.count({ where: { action: 'UPDATE_PAYROLL' } }), 1);
});

test('a payslip cut down to what was paid becomes paid; below it is refused', async () => {
  const { payroll } = await payslip();
  assert.match((await updatePayroll(payroll.id, { amount: 19_000_000, bonuses: 0, deductions: 0 })).message ?? '', /کمتر از مبلغی است که پرداخت شده/);
  assert.equal((await prisma.payroll.findUniqueOrThrow({ where: { id: payroll.id } })).status, 'PARTIAL');

  assert.equal((await updatePayroll(payroll.id, { amount: 25_000_000, bonuses: 0, deductions: 5_000_000 })).success, true);
  const after = await prisma.payroll.findUniqueOrThrow({ where: { id: payroll.id } });
  assert.deepEqual([Number(after.netAmount), after.status], [20_000_000, 'PAID']);

  assert.match((await updatePayroll(payroll.id, { amount: 1_000_000, bonuses: 0, deductions: 2_000_000 })).message ?? '', /بیشتر از صفر/);
});

test('only an admin edits a payslip', async () => {
  const { payroll } = await payslip();
  for (const role of ['ACCOUNTANT', 'AUDITOR', 'SALES', null]) {
    setTestRole(role);
    assert.match((await updatePayroll(payroll.id, { amount: 40_000_000, bonuses: 0, deductions: 0 })).message ?? '', /فقط مدیر سیستم/, String(role));
  }
  assert.equal(Number((await prisma.payroll.findUniqueOrThrow({ where: { id: payroll.id } })).netAmount), 30_000_000);
});
