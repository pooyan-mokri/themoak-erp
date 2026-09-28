import { test, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTimeout as sleep } from 'node:timers/promises';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { createAsset, deleteAsset, getAssets, postDepreciation } from '@/actions/fixed-assets';
import { getProfitLossReport } from '@/actions/reports';
import { deleteExpense, recordWithdrawal, updateExpense } from '@/actions/accounting';
import { Currency } from '@/lib/types';
import { assertBooksAddUp, openAccount } from './ledger';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  beforeQuery.fn = null;
  mock.timers.reset();
  await resetDatabase();
});
after(() => {
  mock.timers.reset();
  return prisma.$disconnect();
});

const YEAR = 365.25 * 24 * 3600 * 1000;
const yearsAgo = (years: number) => new Date(Date.now() - years * YEAR);

const assetForm = (fields: Record<string, string> = {}) =>
  form({ name: 'لپ‌تاپ', assetType: 'FIXED', purchaseDate: '2026-01-01', purchasePrice: '12000000', salvageValue: '2000000', usefulLife: '5', quantity: '', ...fields });

async function asset(purchaseDate: Date, fields: Record<string, unknown> = {}) {
  return prisma.fixedAsset.create({
    data: { name: 'لپ‌تاپ', purchaseDate, purchasePrice: 12_000_000, salvageValue: 2_000_000, usefulLife: 5, ...fields } as any,
  });
}

test('an asset is recorded at its purchase price; a consumable needs a quantity', async () => {
  const created = await createAsset(undefined, assetForm());
  assert.equal(created.success, true, created.message);
  const [laptop] = await prisma.fixedAsset.findMany();
  assert.deepEqual(
    [laptop.assetType, Number(laptop.purchasePrice), Number(laptop.salvageValue), laptop.usefulLife, Number(laptop.currentValue), laptop.quantity],
    ['FIXED', 12_000_000, 2_000_000, 5, 12_000_000, null],
  );
  assert.match((await createAsset(undefined, assetForm({ assetType: 'CONSUMABLE' }))).message!, /فیلدهای الزامی/);
  assert.equal((await createAsset(undefined, assetForm({ name: 'کاغذ', assetType: 'CONSUMABLE', quantity: '20' }))).success, true);
  assert.equal((await prisma.fixedAsset.findFirstOrThrow({ where: { name: 'کاغذ' } })).quantity, 20);

  for (const fields of [{ name: '' }, { purchaseDate: '' }, { purchasePrice: '-1' }, { usefulLife: '0' }, { assetType: 'LAND' }] as Record<string, string>[]) {
    assert.match((await createAsset(undefined, assetForm(fields))).message!, /فیلدهای الزامی/, JSON.stringify(fields));
  }
  assert.equal(await prisma.fixedAsset.count(), 2);
  assert.equal(await prisma.transaction.count(), 0, 'recording an asset moves no money');
});

test('an asset is worth its price less straight-line depreciation, never below its salvage value', async () => {
  await asset(yearsAgo(2), { name: 'دوساله' });
  await asset(yearsAgo(7), { name: 'مستهلک' });
  await asset(new Date(Date.now() + 30 * 24 * 3600 * 1000), { name: 'آینده' });
  const values = Object.fromEntries((await getAssets()).map((a: any) => [a.name, a.currentValue]));
  assert.ok(Math.abs(values['دوساله'] - 8_000_000) < 1, String(values['دوساله']));
  assert.equal(values['مستهلک'], 2_000_000);
  assert.equal(values['آینده'], 12_000_000);
});

test('posting depreciation books one year of it as a non-cash expense, on an expense account that stays at 0', async () => {
  const laptop = await asset(yearsAgo(2));
  const posted = await postDepreciation(laptop.id);
  assert.equal(posted.success, true, posted.message);
  const row = await prisma.transaction.findFirstOrThrow({ include: { account: true } });
  assert.deepEqual(
    [row.type, row.category, Number(row.amount), Number(row.amountInToman), row.account!.name, row.account!.type, Number(row.account!.balance)],
    ['EXPENSE', 'Depreciation', 2_000_000, 2_000_000, 'هزینه‌های عمومی', 'EXPENSE', 0],
  );
  assert.equal((await getProfitLossReport(yearsAgo(1), new Date(Date.now() + 60_000))).summary.expenses, 2_000_000, 'depreciation is an operating expense');
  await assertBooksAddUp();
});

test('two assets depreciated at once share one «هزینه‌های عمومی» account', async () => {
  const [a, b] = [await asset(yearsAgo(2)), await asset(yearsAgo(3))];
  // The second post runs whole after the first has found no account and before it makes one.
  let second = null as Promise<any> | null;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Account' || !['create', 'createMany'].includes(params.action)) return;
    beforeQuery.fn = null;
    second = postDepreciation(b.id);
    await Promise.race([second, sleep(500)]);
  };
  const first = await postDepreciation(a.id);
  beforeQuery.fn = null;
  assert.ok(second, 'the second post was started');
  assert.deepEqual([first.success, (await second!).success], [true, true]);
  assert.equal(await prisma.account.count({ where: { name: 'هزینه‌های عمومی' } }), 1);
  assert.equal(await prisma.transaction.count({ where: { category: 'Depreciation' } }), 2);
});

test('a fully depreciated or unknown asset is not depreciated; an asset is deleted', async () => {
  const old = await asset(yearsAgo(7));
  assert.match((await postDepreciation(old.id)).error!, /کاملاً مستهلک/);
  assert.match((await postDepreciation('nothing')).error!, /یافت نشد/);
  assert.equal(await prisma.transaction.count(), 0);
  assert.equal((await deleteAsset(old.id)).success, true);
  assert.equal(await prisma.fixedAsset.count(), 0);
  assert.equal((await deleteAsset('nothing')).success, false);
});

test('a depreciation row deleted from the expense list leaves its expense account at 0; it cannot be edited there', async () => {
  const laptop = await asset(yearsAgo(2));
  assert.equal((await postDepreciation(laptop.id)).success, true);
  // A second row, as posted twice before a year could be posted only once.
  const first = await prisma.transaction.findFirstOrThrow({ where: { category: 'Depreciation' } });
  const second = await prisma.transaction.create({
    data: { type: 'EXPENSE', amount: 2_000_000, amountInToman: 2_000_000, category: 'Depreciation', description: first.description, accountId: first.accountId },
  });

  assert.match((await updateExpense({ id: first.id, amount: 1, currency: Currency.TOMAN, category: 'Depreciation' })).message!, /سند استهلاک قابل ویرایش نیست/);
  assert.equal((await deleteExpense(second.id)).success, true);
  const account = await prisma.account.findUniqueOrThrow({ where: { id: first.accountId! } });
  assert.equal(Number(account.balance), 0, 'nothing was taken off it, so nothing is given back');
  assert.equal(await prisma.transaction.count({ where: { category: 'Depreciation' } }), 1);
  assert.equal(Number((await prisma.transaction.findUniqueOrThrow({ where: { id: first.id } })).amount), 2_000_000);
});

// ─── Once per asset per Jalali year ───────────────────────────────────────────

const depreciationRows = () => prisma.transaction.findMany({ where: { category: 'Depreciation' }, orderBy: { createdAt: 'asc' } });

test('depreciation is booked once per asset per Jalali year; the next year it is booked again', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-28T08:00:00Z') }); // 6 Mehr 1405
  const laptop = await asset(new Date('2024-09-01T00:00:00Z'));
  const other = await asset(new Date('2024-09-01T00:00:00Z'), { name: 'چاپگر' });

  assert.equal((await postDepreciation(laptop.id)).success, true);
  const again = await postDepreciation(laptop.id);
  assert.equal(again.success, false);
  assert.equal(again.error, 'استهلاک سال ۱۴۰۵ برای «لپ‌تاپ» قبلاً ثبت شده است.');
  assert.equal((await postDepreciation(other.id)).success, true, 'another asset has its own year');
  assert.equal((await depreciationRows()).length, 2);

  // 1 Farvardin 1406 in Tehran.
  mock.timers.setTime(new Date('2027-03-20T20:30:00Z').getTime());
  assert.equal((await postDepreciation(laptop.id)).success, true);
  const rows = await depreciationRows();
  assert.deepEqual(rows.map((r: any) => r.clientRequestId), [
    `depreciation-${laptop.id}-1405`, `depreciation-${other.id}-1405`, `depreciation-${laptop.id}-1406`,
  ]);
});

test('a double click posts one year\'s depreciation once, and the other click is told so', async () => {
  const laptop = await asset(yearsAgo(2));
  let second = null as Promise<any> | null;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Transaction' || params.action !== 'create') return;
    beforeQuery.fn = null;
    second = postDepreciation(laptop.id);
    await Promise.race([second, sleep(500)]);
  };
  const first = await postDepreciation(laptop.id);
  beforeQuery.fn = null;
  const other = await second!;
  assert.deepEqual([first.success, other.success].sort(), [false, true]);
  assert.match((first.success ? other : first).error!, /قبلاً ثبت شده است/);
  assert.equal((await depreciationRows()).length, 1);
});

test('a row posted before the once-a-year rule counts for its year, and the total never passes cost less salvage', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-28T08:00:00Z') }); // 1405
  const laptop = await asset(new Date('2022-09-01T00:00:00Z'), { usefulLife: 5 });
  const legacy = (date: string, amount: number) =>
    prisma.transaction.create({
      data: { type: 'EXPENSE', amount, amountInToman: amount, category: 'Depreciation', description: 'استهلاک سالانه دارایی: لپ‌تاپ', date: new Date(date) },
    });
  await legacy('2026-05-01T08:00:00Z', 2_000_000); // 1405, before the rule
  assert.match((await postDepreciation(laptop.id)).error!, /قبلاً ثبت شده است/);

  // Three earlier years posted twice by mistake: 8,500,000 of the 10,000,000 base is gone.
  await prisma.transaction.deleteMany({ where: { category: 'Depreciation' } });
  for (const date of ['2023-05-01', '2023-06-01', '2024-05-01', '2025-05-01']) await legacy(`${date}T08:00:00Z`, 2_000_000);
  await legacy('2025-06-01T08:00:00Z', 500_000);
  assert.equal((await postDepreciation(laptop.id)).success, true);
  const last = (await depreciationRows()).at(-1)!;
  assert.equal(Number(last.amount), 1_500_000, 'only what is left of the base');
  assert.match((await postDepreciation(laptop.id)).error!, /قبلاً ثبت شده|کاملاً مستهلک/);
});

test('equipment bought is an asset, not an expense; its depreciation is', async () => {
  await openAccount('bank', 50_000_000);
  const bought = await recordWithdrawal(undefined, form({ amount: '12000000', currency: 'TOMAN', accountId: 'bank', payee: 'فروشگاه', category: 'خرید تجهیزات' }));
  assert.equal(bought.success, true, bought.message);
  const laptop = await asset(yearsAgo(2));
  assert.equal((await postDepreciation(laptop.id)).success, true);
  const report = await getProfitLossReport(yearsAgo(1), new Date(Date.now() + 60_000));
  assert.equal(report.summary.operatingExpenses, 2_000_000);
  assert.deepEqual(report.expensesByCategory, { Depreciation: 2_000_000 });
});
