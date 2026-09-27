import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { createPayroll, getPayrollById, getPayrolls, recordPayrollPayment, updatePayroll } from '@/actions/payroll';
import { assertBooksAddUp, balanceOf, openAccount } from './ledger';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

let sara: { id: string };

beforeEach(async () => {
  setTestRole('ADMIN');
  beforeQuery.fn = null;
  await resetDatabase();
  await prisma.user.create({ data: { id: 'test-user', name: 'Test', email: 'test@example.com', password: 'x' } });
  await openAccount('bank', 100_000_000);
  sara = await prisma.employee.create({ data: { name: 'سارا', salary: 30_000_000 } });
});
after(() => prisma.$disconnect());

/**
 * The payroll invariants: net = amount + bonuses − deductions, paid is the sum
 * of the payments and never above net, and the status follows paid against net.
 */
async function assertPayslipsAddUp() {
  for (const p of await prisma.payroll.findMany({ include: { payments: true } })) {
    const [amount, bonuses, deductions, net, paid] = [p.amount, p.bonuses, p.deductions, p.netAmount, p.paidAmount].map(Number);
    assert.equal(net, amount + bonuses - deductions, 'net = amount + bonuses − deductions');
    assert.equal(paid, p.payments.reduce((sum: number, x: any) => sum + Number(x.amount), 0), 'paid is the sum of its payments');
    assert.ok(paid <= net + 0.01, `paid ${paid} is above net ${net}`);
    assert.equal(p.status, paid >= net - 0.01 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'PENDING');
  }
  await assertBooksAddUp();
}

async function payslip(fields: Record<string, string> = {}) {
  const created = await createPayroll(undefined, form({ employeeId: sara.id, amount: '30000000', periodMonth: '7', periodYear: '1405', ...fields }));
  assert.equal(created.success, true, created.message);
  return prisma.payroll.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
}

const pay = (payrollId: string, amount: string, accountId = 'bank', extra: Record<string, string> = {}) =>
  recordPayrollPayment(undefined, form({ payrollId, amount, accountId, ...extra }));

test('a payslip is net = base + bonuses − deductions, pending, with nothing paid and no money moved', async () => {
  const p = await payslip({ bonuses: '5000000', deductions: '1500000', description: 'مهر' });
  assert.deepEqual(
    [Number(p.amount), Number(p.bonuses), Number(p.deductions), Number(p.netAmount), Number(p.paidAmount), p.status, p.description, p.periodMonth, p.periodYear],
    [30_000_000, 5_000_000, 1_500_000, 33_500_000, 0, 'PENDING', 'مهر', 7, 1405],
  );
  const plain = await payslip({ periodMonth: '8' });
  assert.deepEqual([Number(plain.bonuses), Number(plain.deductions), Number(plain.netAmount)], [0, 0, 30_000_000]);
  assert.equal(await prisma.transaction.count({ where: { NOT: { category: 'موجودی اولیه' } } }), 0);
  assert.equal(await balanceOf('bank'), 100_000_000);
  await assertPayslipsAddUp();
});

test('a payslip is refused for a period already paid, an unknown employee, a bad period or amount, or a net of 0 or less', async () => {
  await payslip();
  const cases: [Record<string, string>, RegExp][] = [
    [{}, /قبلاً فیش حقوقی ثبت شده/],
    [{ employeeId: 'nobody', periodMonth: '9' }, /کارمند یافت نشد/],
    [{ periodMonth: '0' }, /فیلدهای الزامی/],
    [{ periodMonth: '13' }, /فیلدهای الزامی/],
    [{ periodYear: '1399', periodMonth: '9' }, /فیلدهای الزامی/],
    [{ amount: '0', periodMonth: '9' }, /فیلدهای الزامی/],
    [{ amount: '-1000', periodMonth: '9' }, /فیلدهای الزامی/],
    [{ bonuses: '-1', periodMonth: '9' }, /فیلدهای الزامی/],
    [{ deductions: '30000000', periodMonth: '9' }, /حقوق خالص .* باید بیشتر از صفر/],
    [{ deductions: '40000000', periodMonth: '9' }, /حقوق خالص .* باید بیشتر از صفر/],
  ];
  for (const [fields, message] of cases) {
    const result = await createPayroll(undefined, form({ employeeId: sara.id, amount: '30000000', periodMonth: '7', periodYear: '1405', ...fields }));
    assert.equal(result.success, false, JSON.stringify(fields));
    assert.match(result.message!, message, JSON.stringify(fields));
  }
  assert.equal(await prisma.payroll.count(), 1);
});

test('a payslip and a payment typed in Persian digits are read as the numbers they are', async () => {
  const created = await createPayroll(
    undefined,
    form({ employeeId: sara.id, amount: '۳۰٬۰۰۰٬۰۰۰', bonuses: '٥٠٠٠٠٠٠', deductions: '۱۵۰۰۰۰۰٫۵', periodMonth: '۷', periodYear: '۱۴۰۵' }),
  );
  assert.equal(created.success, true, created.message);
  const p = await prisma.payroll.findFirstOrThrow();
  assert.deepEqual(
    [Number(p.amount), Number(p.bonuses), Number(p.deductions), Number(p.netAmount), p.periodMonth, p.periodYear],
    [30_000_000, 5_000_000, 1_500_000.5, 33_499_999.5, 7, 1405],
  );
  const paid = await pay(p.id, '۱۰۰۰۰۰۰۰');
  assert.equal(paid.success, true, paid.message);
  assert.equal(Number((await prisma.payroll.findFirstOrThrow()).paidAmount), 10_000_000);
  assert.equal(await balanceOf('bank'), 90_000_000);
  await assertPayslipsAddUp();
});

test('paying part, then the rest: each payment is an expense row, a payment record and a balance move', async () => {
  const p = await payslip({ bonuses: '2000000' });

  const first = await pay(p.id, '12000000', 'bank', { date: '2026-10-05T20:30:00.000Z', description: 'قسط اول' });
  assert.equal(first.success, true, first.message);
  let now = await prisma.payroll.findUniqueOrThrow({ where: { id: p.id } });
  assert.deepEqual([Number(now.paidAmount), now.status], [12_000_000, 'PARTIAL']);
  const row = await prisma.transaction.findFirstOrThrow({ where: { category: 'Salary' }, include: { PayrollPayment: true } });
  assert.deepEqual(
    [row.type, Number(row.amount), Number(row.amountInToman), row.currency, row.accountId, row.description, row.date.toISOString()],
    ['EXPENSE', 12_000_000, 12_000_000, 'TOMAN', 'bank', 'قسط اول', '2026-10-05T20:30:00.000Z'],
  );
  assert.equal(Number(row.PayrollPayment!.amount), 12_000_000);
  assert.equal(row.PayrollPayment!.payrollId, p.id);
  assert.equal(await balanceOf('bank'), 88_000_000);

  const rest = await pay(p.id, '20000000');
  assert.equal(rest.success, true, rest.message);
  now = await prisma.payroll.findUniqueOrThrow({ where: { id: p.id } });
  assert.deepEqual([Number(now.paidAmount), now.status], [32_000_000, 'PAID']);
  assert.match((await prisma.transaction.findFirstOrThrow({ where: { category: 'Salary', amount: 20_000_000 } })).description!, /پرداخت حقوق - سارا - 1405\/7/);
  assert.equal(await balanceOf('bank'), 68_000_000);
  await assertPayslipsAddUp();
});

test('a payment above what is left, from an unknown account or one that cannot cover it, or of 0, is refused and moves nothing', async () => {
  const p = await payslip();
  assert.equal((await pay(p.id, '10000000')).success, true);
  await openAccount('small', 1_000_000);
  const before = { rows: await prisma.transaction.count(), payments: await prisma.payrollPayment.count() };

  const cases: [string, string, string, RegExp][] = [
    [p.id, '20000001', 'bank', /بیشتر از باقیمانده/],
    [p.id, '5000000', 'nowhere', /حساب یافت نشد/],
    [p.id, '5000000', 'small', /کافی نیست/],
    ['nobody', '5000000', 'bank', /فیش حقوقی یافت نشد/],
    [p.id, '0', 'bank', /فیلدهای الزامی/],
    [p.id, '-5', 'bank', /فیلدهای الزامی/],
    [p.id, 'abc', 'bank', /فیلدهای الزامی/],
  ];
  for (const [payrollId, amount, accountId, message] of cases) {
    const result = await pay(payrollId, amount, accountId);
    assert.equal(result.success, false, `${payrollId} ${amount} ${accountId}`);
    assert.match(result.message!, message);
  }
  assert.deepEqual({ rows: await prisma.transaction.count(), payments: await prisma.payrollPayment.count() }, before);
  assert.equal(await balanceOf('bank'), 90_000_000);
  assert.equal(await balanceOf('small'), 1_000_000);
  await assertPayslipsAddUp();
});

test('paid from a dollar account, the Toman pay leaves the account in dollars at the latest rate', async () => {
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 100_000, date: new Date('2026-09-20') } });
  await openAccount('usd', 1_000, 'USD');
  const p = await payslip();
  const paid = await pay(p.id, '30000000', 'usd');
  assert.equal(paid.success, true, paid.message);
  assert.equal(await balanceOf('usd'), 700);
  const row = await prisma.transaction.findFirstOrThrow({ where: { category: 'Salary' } });
  assert.deepEqual([Number(row.amount), row.currency, Number(row.amountInToman), Number(row.rateSnapshot)], [300, 'USD', 30_000_000, 100_000]);
  await assertPayslipsAddUp();
});

test('two payments of the same payslip at the same moment: paid never goes above net', async () => {
  const p = await payslip();
  // The second payment arrives after the first has checked what is left and before it has written.
  let second = null as Promise<any> | null;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Transaction' || params.action !== 'create') return;
    beforeQuery.fn = null;
    second = pay(p.id, '20000000');
    await Promise.race([second, sleep(500)]);
  };
  const first = await pay(p.id, '20000000');
  beforeQuery.fn = null;
  assert.ok(second, 'the second payment was started');
  const other = await second!;

  assert.deepEqual([first.success, other.success].sort(), [false, true]);
  const now = await prisma.payroll.findUniqueOrThrow({ where: { id: p.id } });
  assert.deepEqual([Number(now.paidAmount), now.status], [20_000_000, 'PARTIAL']);
  assert.equal(await balanceOf('bank'), 80_000_000);
  await assertPayslipsAddUp();
});

test('a payment and an edit of the same payslip at the same moment leave paid within net', async () => {
  const p = await payslip();
  // The edit lowers net to 18,000,000 while a 20,000,000 payment is under way.
  let edit = null as Promise<any> | null;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Transaction' || params.action !== 'create') return;
    beforeQuery.fn = null;
    edit = updatePayroll(p.id, { amount: 18_000_000, bonuses: 0, deductions: 0 });
    await Promise.race([edit, sleep(500)]);
  };
  const paid = await pay(p.id, '20000000');
  beforeQuery.fn = null;
  const edited = await edit!;

  // Whichever ran first, the other one saw its result.
  assert.equal(paid.success !== edited.success, true, `${paid.message} / ${edited.message}`);
  await assertPayslipsAddUp();
});

test('the payroll list filters by employee and status, newest period first; one payslip comes with its payments', async () => {
  const reza = await prisma.employee.create({ data: { name: 'رضا', salary: 1 } });
  const mehr = await payslip();
  await payslip({ periodMonth: '8' });
  await payslip({ periodMonth: '12', periodYear: '1404' });
  await createPayroll(undefined, form({ employeeId: reza.id, amount: '1000000', periodMonth: '7', periodYear: '1405' }));
  assert.equal((await pay(mehr.id, '1000000', 'bank', { description: 'علی‌الحساب' })).success, true);

  assert.deepEqual((await getPayrolls(sara.id)).map((p: any) => `${p.periodYear}/${p.periodMonth}`), ['1405/8', '1405/7', '1404/12']);
  assert.deepEqual((await getPayrolls(undefined, 'PARTIAL')).map((p: any) => p.id), [mehr.id]);
  assert.equal((await getPayrolls()).length, 4);

  const one = await getPayrollById(mehr.id);
  assert.equal(one!.netAmount, 30_000_000);
  assert.equal(one!.paidAmount, 1_000_000);
  assert.equal(one!.payments[0].amount, 1_000_000);
  assert.equal(one!.payments[0].account.name, 'حساب bank');
  assert.equal(one!.payments[0].transaction!.amountInToman, 1_000_000);
  assert.equal(await getPayrollById('nobody'), undefined);
});

test('an edit of an unknown payslip or with a negative bonus is refused; the description can be cleared', async () => {
  const p = await payslip({ description: 'مهر' });
  assert.match((await updatePayroll('nobody', { amount: 1, bonuses: 0, deductions: 0 })).message!, /یافت نشد/);
  assert.equal((await updatePayroll(p.id, { amount: 1, bonuses: -1, deductions: 0 })).success, false);

  assert.equal((await updatePayroll(p.id, { amount: 30_000_000, bonuses: 0, deductions: 0 })).success, true);
  assert.equal((await prisma.payroll.findUniqueOrThrow({ where: { id: p.id } })).description, 'مهر', 'no description given: kept');
  assert.equal((await updatePayroll(p.id, { amount: 30_000_000, bonuses: 0, deductions: 0, description: '' })).success, true);
  assert.equal((await prisma.payroll.findUniqueOrThrow({ where: { id: p.id } })).description, null);
  await assertPayslipsAddUp();
});
