import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { createEmployee, deleteEmployee, getEmployeeById, getEmployees, updateEmployee } from '@/actions/employee';
import { recordExpense } from '@/actions/accounting';
import { createPayroll, recordPayrollPayment } from '@/actions/payroll';
import { openAccount } from './ledger';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const employeeForm = (fields: Record<string, string> = {}) =>
  form({ name: 'سارا احمدی', nationalId: '0012345678', phone: '09121234567', email: 'sara@example.com', position: 'فروشنده', hireDate: '2026-03-20T20:30:00.000Z', salary: '30000000', ...fields });

test('an employee is saved with every field; the list and the page read it back', async () => {
  const created = await createEmployee(undefined, employeeForm({ address: 'تهران' }));
  assert.equal(created.success, true, created.message);
  const [listed] = await getEmployees();
  assert.deepEqual(
    [listed.name, listed.nationalId, listed.phone, listed.email, listed.position, listed.address, listed.salary, listed.hireDate?.toISOString()],
    ['سارا احمدی', '0012345678', '09121234567', 'sara@example.com', 'فروشنده', 'تهران', 30_000_000, '2026-03-20T20:30:00.000Z'],
  );
  assert.equal((await getEmployeeById(listed.id))!.salary, 30_000_000);
  assert.equal(await getEmployeeById('nobody'), undefined);

  const minimal = await createEmployee(undefined, form({ name: 'رضا', salary: '0' }));
  assert.equal(minimal.success, true, minimal.message);
  const reza = (await getEmployees()).find((e: any) => e.name === 'رضا');
  assert.deepEqual([reza.nationalId, reza.email, reza.hireDate, reza.salary], [undefined, undefined, undefined, 0]);
});

test('a national id or email already in use, a bad email, a missing name or a negative salary is refused', async () => {
  assert.equal((await createEmployee(undefined, employeeForm())).success, true);
  const cases: [Record<string, string>, RegExp][] = [
    [{ email: 'other@example.com' }, /کد ملی قبلاً ثبت شده/],
    [{ nationalId: '0099999999' }, /ایمیل قبلاً ثبت شده/],
    [{ nationalId: '0099999999', email: 'not-an-email' }, /فیلدهای الزامی/],
    [{ nationalId: '0099999999', email: 'x@example.com', name: '' }, /فیلدهای الزامی/],
    [{ nationalId: '0099999999', email: 'x@example.com', salary: '-1' }, /فیلدهای الزامی/],
    [{ nationalId: '0099999999', email: 'x@example.com', salary: 'abc' }, /فیلدهای الزامی/],
  ];
  for (const [fields, message] of cases) {
    const result = await createEmployee(undefined, employeeForm(fields));
    assert.equal(result.success, false, JSON.stringify(fields));
    assert.match(result.message!, message, JSON.stringify(fields));
  }
  assert.equal(await prisma.employee.count(), 1);
});

test('a national id and salary typed in Persian digits are the same id and number', async () => {
  const created = await createEmployee(undefined, employeeForm({ nationalId: '۰۰۱۲۳۴۵۶۷۸', phone: '۰۹۱۲۱۲۳۴۵۶۷', salary: '۳۰٬۰۰۰٬۰۰۰' }));
  assert.equal(created.success, true, created.message);
  const [sara] = await getEmployees();
  assert.deepEqual([sara.nationalId, sara.phone, sara.salary], ['0012345678', '09121234567', 30_000_000]);
  // The same id in Latin digits, or in Arabic-Indic ones, is already in use.
  for (const nationalId of ['0012345678', '٠٠١٢٣٤٥٦٧٨']) {
    const again = await createEmployee(undefined, employeeForm({ nationalId, email: 'other@example.com' }));
    assert.match(again.message!, /کد ملی قبلاً ثبت شده/, nationalId);
  }
  assert.equal(await prisma.employee.count(), 1);
});

test('an edit keeps an employee\'s own national id and email, and refuses another\'s', async () => {
  await createEmployee(undefined, employeeForm());
  await createEmployee(undefined, employeeForm({ name: 'رضا', nationalId: '0022222222', email: 'reza@example.com' }));
  const sara = (await getEmployees()).find((e: any) => e.name === 'سارا احمدی');

  const raised = await updateEmployee(sara.id, undefined, employeeForm({ salary: '35000000', position: 'مدیر فروش' }));
  assert.equal(raised.success, true, raised.message);
  assert.deepEqual([(await getEmployeeById(sara.id))!.salary, (await getEmployeeById(sara.id))!.position], [35_000_000, 'مدیر فروش']);

  assert.match((await updateEmployee(sara.id, undefined, employeeForm({ nationalId: '0022222222' }))).message!, /کد ملی قبلاً ثبت شده/);
  assert.match((await updateEmployee(sara.id, undefined, employeeForm({ email: 'reza@example.com' }))).message!, /ایمیل قبلاً ثبت شده/);
  assert.equal((await getEmployeeById(sara.id))!.nationalId, '0012345678');
});

test('an employee with no history is deleted; one with a loan, a payslip or money rows is not, and nothing is lost', async () => {
  await openAccount('bank', 100_000_000);
  const make = async (name: string) => (await prisma.employee.create({ data: { name, salary: 1 } })).id;
  const free = await make('بدون سابقه');
  const withLoan = await make('با قرض');
  const withPayslip = await make('با فیش');
  const withExpense = await make('با هزینه');
  await prisma.loan.create({ data: { employeeId: withLoan, amount: 1, remaining: 1 } });
  assert.equal((await createPayroll(undefined, form({ employeeId: withPayslip, amount: '1000000', periodMonth: '7', periodYear: '1405' }))).success, true);
  const payslip = await prisma.payroll.findFirstOrThrow();
  assert.equal((await recordPayrollPayment(undefined, form({ payrollId: payslip.id, amount: '1000000', accountId: 'bank' }))).success, true);
  assert.equal((await recordExpense(undefined, form({ amount: '5000', currency: 'TOMAN', category: 'پیک', employeeId: withExpense }))).success, true);

  assert.equal((await deleteEmployee(free)).success, true);
  assert.match((await deleteEmployee(withLoan)).message!, /قرض دارد/);
  for (const id of [withPayslip, withExpense]) {
    const refused = await deleteEmployee(id);
    assert.equal(refused.success, false);
    assert.match(refused.message!, /فیش حقوقی یا تراکنش/);
  }
  assert.equal(await prisma.employee.count(), 3);
  assert.equal(await prisma.payroll.count(), 1, 'the payslip and its payment are kept');
  assert.equal(await prisma.payrollPayment.count(), 1);
});
