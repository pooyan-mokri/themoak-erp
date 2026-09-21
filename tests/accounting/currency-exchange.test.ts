import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import {
  deleteCurrencyExchange,
  exchangeCurrency,
  getCurrencyExchangeHistory,
  updateCurrencyExchange,
} from '@/actions/currency-exchange';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const ADMIN_ONLY = 'دسترسی غیرمجاز — فقط مدیر سیستم می‌تواند سند معامله ارز را ویرایش یا حذف کند.';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
  await prisma.account.createMany({
    data: [
      { id: 'toman', name: 'بانک تومان', type: 'BANK', currency: 'TOMAN', balance: 1_000_000_000 },
      { id: 'usd', name: 'صندوق دلار', type: 'CASH', currency: 'USD', balance: 100 },
      { id: 'eur', name: 'صندوق یورو', type: 'CASH', currency: 'EUR', balance: 0 },
    ],
  });
});
after(() => prisma.$disconnect());

const balances = async () =>
  Object.fromEntries(
    (await prisma.account.findMany({ orderBy: { id: 'asc' } })).map((a: any) => [a.id, Number(a.balance)]),
  );

/** Buys `foreign` USD for `toman` Toman, on `date`. */
async function buyUsd(toman: number, foreign: number, date = '2026-09-20') {
  const result = await exchangeCurrency(
    undefined,
    form({
      sourceAccountId: 'toman',
      targetAccountId: 'usd',
      sourceAmount: String(toman),
      targetAmount: String(foreign),
      sourceCurrency: 'TOMAN',
      targetCurrency: 'USD',
      exchangeRate: String(toman / foreign),
      date,
      // The record form always posts this field, even empty.
      description: '',
    }),
  );
  assert.equal(result.success, true, result.message);
}

test('two exchanges on the same day are listed as they were recorded, not mixed up', async () => {
  await buyUsd(10_000_000, 100);
  // The same date, and back the other way: the two legs could be crossed with the first exchange's.
  const second = await exchangeCurrency(
    undefined,
    form({
      sourceAccountId: 'usd',
      targetAccountId: 'toman',
      sourceAmount: '50',
      targetAmount: '9000000',
      sourceCurrency: 'USD',
      targetCurrency: 'TOMAN',
      exchangeRate: '180000',
      date: '2026-09-20',
      description: '',
    }),
  );
  assert.equal(second.success, true, second.message);

  const history = await getCurrencyExchangeHistory();
  assert.equal(history.length, 2);
  for (const row of history) assert.equal(row.complete, true);

  const bought = history.find((row) => row.sourceAccount === 'بانک تومان')!;
  assert.equal(bought.sourceAmount, 10_000_000);
  assert.equal(bought.targetAmount, 100);
  const sold = history.find((row) => row.sourceAccount === 'صندوق دلار')!;
  assert.equal(sold.sourceAmount, 50);
  assert.equal(sold.targetAmount, 9_000_000);
});

test('editing a wrong exchange moves the balances to what it should have been', async () => {
  await buyUsd(10_000_000, 100);
  assert.deepEqual(await balances(), { eur: 0, toman: 990_000_000, usd: 200 });

  const [recorded] = await getCurrencyExchangeHistory();
  const fixed = await updateCurrencyExchange({
    id: recorded.id,
    sourceAccountId: 'toman',
    targetAccountId: 'usd',
    sourceAmount: 8_000_000,
    targetAmount: 80,
    sourceCurrency: 'TOMAN' as any,
    targetCurrency: 'USD' as any,
    exchangeRate: 100_000,
    date: '2026-09-21',
    description: 'اصلاح شد',
  });
  assert.equal(fixed.success, true, fixed.message);

  // As if it had been recorded this way: 8m off the Toman account, 80 on the dollar one.
  assert.deepEqual(await balances(), { eur: 0, toman: 992_000_000, usd: 180 });
  const history = await getCurrencyExchangeHistory();
  assert.equal(history.length, 1, 'the same document, not a second one');
  assert.equal(history[0].sourceAmount, 8_000_000);
  assert.equal(history[0].targetAmount, 80);
  assert.equal(history[0].description, 'اصلاح شد');
  assert.equal(await prisma.transaction.count(), 2);
});

test('editing onto other accounts takes the money back from the first pair', async () => {
  await buyUsd(10_000_000, 100);
  const [recorded] = await getCurrencyExchangeHistory();

  const moved = await updateCurrencyExchange({
    id: recorded.id,
    sourceAccountId: 'toman',
    targetAccountId: 'eur',
    sourceAmount: 10_000_000,
    targetAmount: 90,
    sourceCurrency: 'TOMAN' as any,
    targetCurrency: 'EUR' as any,
    exchangeRate: 111_111,
    date: '2026-09-20',
  });
  assert.equal(moved.success, true, moved.message);
  assert.deepEqual(await balances(), { eur: 90, toman: 990_000_000, usd: 100 });
});

test('an edit that the accounts cannot cover changes nothing', async () => {
  await buyUsd(10_000_000, 100);
  const before = await balances();
  const [recorded] = await getCurrencyExchangeHistory();

  const refused = await updateCurrencyExchange({
    id: recorded.id,
    sourceAccountId: 'toman',
    targetAccountId: 'usd',
    sourceAmount: 5_000_000_000,
    targetAmount: 50_000,
    sourceCurrency: 'TOMAN' as any,
    targetCurrency: 'USD' as any,
    exchangeRate: 100_000,
  });
  assert.equal(refused.success, false);
  assert.match(refused.message, /موجودی حساب مبدا کافی نیست/);
  assert.deepEqual(await balances(), before);
  const [unchanged] = await getCurrencyExchangeHistory();
  assert.equal(unchanged.sourceAmount, 10_000_000);
});

test('deleting an exchange gives both accounts their money back and removes both legs', async () => {
  await buyUsd(10_000_000, 100);
  const [recorded] = await getCurrencyExchangeHistory();

  const removed = await deleteCurrencyExchange(recorded.id);
  assert.equal(removed.success, true, removed.message);
  assert.deepEqual(await balances(), { eur: 0, toman: 1_000_000_000, usd: 100 });
  assert.equal(await prisma.transaction.count(), 0);
  assert.deepEqual(await getCurrencyExchangeHistory(), []);
});

test('only the admin may edit or delete a recorded exchange', async () => {
  await buyUsd(10_000_000, 100);
  const before = await balances();
  const [recorded] = await getCurrencyExchangeHistory();

  for (const role of ['ACCOUNTANT', 'AUDITOR', 'SALES', 'WAREHOUSE', null]) {
    setTestRole(role);
    const edit = await updateCurrencyExchange({
      id: recorded.id,
      sourceAccountId: 'toman',
      targetAccountId: 'usd',
      sourceAmount: 1,
      targetAmount: 1,
      sourceCurrency: 'TOMAN' as any,
      targetCurrency: 'USD' as any,
      exchangeRate: 1,
    });
    assert.equal(edit.success, false, String(role));
    assert.equal(edit.message, ADMIN_ONLY, String(role));

    const remove = await deleteCurrencyExchange(recorded.id);
    assert.equal(remove.success, false, String(role));
    assert.equal(remove.message, ADMIN_ONLY, String(role));
  }

  setTestRole('ADMIN');
  assert.deepEqual(await balances(), before);
  assert.equal(await prisma.transaction.count(), 2);
});

test('an exchange recorded before the two legs were linked is still paired, edited and deleted', async () => {
  await buyUsd(10_000_000, 100);
  // Exactly what the old code wrote: two legs with no link between them.
  await prisma.transaction.updateMany({ data: { exchangeGroupId: null } });

  const [legacy] = await getCurrencyExchangeHistory();
  assert.equal(legacy.complete, true);
  assert.equal(legacy.sourceAmount, 10_000_000);
  assert.equal(legacy.targetAmount, 100);

  const fixed = await updateCurrencyExchange({
    id: legacy.id,
    sourceAccountId: 'toman',
    targetAccountId: 'usd',
    sourceAmount: 9_000_000,
    targetAmount: 90,
    sourceCurrency: 'TOMAN' as any,
    targetCurrency: 'USD' as any,
    exchangeRate: 100_000,
  });
  assert.equal(fixed.success, true, fixed.message);
  assert.deepEqual(await balances(), { eur: 0, toman: 991_000_000, usd: 190 });
  assert.equal(await prisma.transaction.count(), 2, 'the old legs are rewritten, not duplicated');

  const [linked] = await getCurrencyExchangeHistory();
  const removed = await deleteCurrencyExchange(linked.id);
  assert.equal(removed.success, true, removed.message);
  assert.deepEqual(await balances(), { eur: 0, toman: 1_000_000_000, usd: 100 });
});

test('a lone exchange leg is listed as incomplete and can be removed', async () => {
  await buyUsd(10_000_000, 100);
  const [{ id: groupId }] = await getCurrencyExchangeHistory();
  // Someone deleted the Toman leg by hand at some point.
  await prisma.transaction.deleteMany({ where: { type: 'EXPENSE' } });

  const [orphan] = await getCurrencyExchangeHistory();
  assert.equal(orphan.complete, false);
  assert.equal(orphan.sourceAccount, null);
  assert.equal(orphan.targetAmount, 100);
  assert.equal(orphan.id, groupId);

  const removed = await deleteCurrencyExchange(orphan.id);
  assert.equal(removed.success, true, removed.message);
  assert.equal(Number((await prisma.account.findUniqueOrThrow({ where: { id: 'usd' } })).balance), 100);
  assert.equal(await prisma.transaction.count(), 0);
});

test('a lone legacy leg next to a whole exchange is removed alone, as the list shows it', async () => {
  // An exchange sent twice (1.7 s apart) before the legs were linked; later
  // someone removed the first copy's Toman leg by hand, giving its Toman back.
  await buyUsd(10_000_000, 100);
  await buyUsd(10_000_000, 100);
  await prisma.transaction.updateMany({ data: { exchangeGroupId: null } });
  const at = new Date('2026-09-20T10:00:00Z').getTime();
  const [source1, source2] = await prisma.transaction.findMany({ where: { type: 'EXPENSE' }, orderBy: { createdAt: 'asc' } });
  const [target1, target2] = await prisma.transaction.findMany({ where: { type: 'INCOME' }, orderBy: { createdAt: 'asc' } });
  const stamp = (id: string, ms: number) =>
    prisma.transaction.update({ where: { id }, data: { createdAt: new Date(at + ms) } });
  await stamp(source1.id, 0);
  await stamp(target1.id, 3);
  await stamp(source2.id, 1_700);
  await stamp(target2.id, 1_703);
  await prisma.transaction.delete({ where: { id: source1.id } });
  await prisma.account.update({ where: { id: 'toman' }, data: { balance: { increment: 10_000_000 } } });
  assert.deepEqual(await balances(), { eur: 0, toman: 990_000_000, usd: 300 });

  const listed = await getCurrencyExchangeHistory();
  assert.equal(listed.length, 2);
  const whole = listed.find((row) => row.complete)!;
  const lone = listed.find((row) => !row.complete)!;
  assert.ok(whole && lone);
  assert.equal(lone.sourceAccount, null);

  // Removing the lone dollar leg takes back only its 100 dollars; the whole exchange stays.
  const removed = await deleteCurrencyExchange(lone.id);
  assert.equal(removed.success, true, removed.message);
  assert.deepEqual(await balances(), { eur: 0, toman: 990_000_000, usd: 200 });
  const left = await getCurrencyExchangeHistory();
  assert.equal(left.length, 1);
  assert.equal(left[0].complete, true);
  assert.equal(left[0].sourceAmount, 10_000_000);
  assert.equal(left[0].targetAmount, 100);
});
