import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import {
  adjustAccountBalance,
  createAccount,
  getAccountReconciliation,
  recordBalanceBaseline,
  recordBankCheck,
  recordDeposit,
} from '@/actions/accounting';
import { adjustmentWarning } from '@/components/accounting/account-reconciliation';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const ADMIN_ONLY = 'دسترسی غیرمجاز — فقط مدیر سیستم می‌تواند این عملیات را انجام دهد.';

beforeEach(async () => {
  setTestRole('ADMIN');
  beforeQuery.fn = null;
  await resetDatabase();
});
after(() => prisma.$disconnect());

const rowOf = async (id: string) => {
  const row = (await getAccountReconciliation()).find((r) => r.id === id);
  assert.ok(row, `no reconciliation row for ${id}`);
  return row;
};
const balanceOf = async (id: string) => Number((await prisma.account.findUniqueOrThrow({ where: { id } })).balance);
const rowsOf = (accountId: string) => prisma.transaction.findMany({ where: { accountId }, orderBy: { createdAt: 'asc' } });

/**
 * An account whose stored balance is `history` ahead of its rows, as the
 * production accounts are today: 3,000,000 of sales plus an opening balance or
 * an old overwrite that left no row.
 */
async function legacyAccount(id: string, history: number, currency = 'TOMAN') {
  await prisma.account.create({
    data: { id, name: `حساب ${id}`, type: 'BANK', currency: currency as any, balance: 3_000_000 + history },
  });
  await prisma.transaction.create({
    data: { type: 'INCOME', amount: 3_000_000, amountInToman: 3_000_000, currency: currency as any, accountId: id, category: 'فروش' },
  });
}

test('a new account with an opening balance shows a difference of 0', async () => {
  const created = await createAccount(
    undefined,
    form({ name: 'تنخواه', type: 'CASH', currency: 'TOMAN', initialBalance: '2080346' }),
  );
  assert.equal(created.success, true, created.message);
  const account = await prisma.account.findFirstOrThrow({ where: { name: 'تنخواه' } });
  assert.equal(Number(account.balance), 2_080_346);

  const rows = await rowsOf(account.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'ADJUSTMENT');
  assert.equal(Number(rows[0].amount), 2_080_346);
  assert.equal(rows[0].description, 'موجودی اولیه');

  const row = await rowOf(account.id);
  assert.equal(row.computed, 2_080_346);
  assert.equal(row.difference, 0);

  // No opening balance: no row, and still nothing to explain.
  const empty = await createAccount(undefined, form({ name: 'بانک خالی', type: 'BANK', currency: 'TOMAN' }));
  assert.equal(empty.success, true, empty.message);
  const emptyAccount = await prisma.account.findFirstOrThrow({ where: { name: 'بانک خالی' } });
  assert.equal((await rowsOf(emptyAccount.id)).length, 0);
  assert.equal((await rowOf(emptyAccount.id)).difference, 0);
});

test('the baseline records the historical difference once, as one row, and leaves the balance alone', async () => {
  await legacyAccount('ahead', 7_000_000);
  await legacyAccount('behind', -1_000_000);
  assert.equal((await rowOf('ahead')).difference, 7_000_000);
  assert.equal((await rowOf('behind')).difference, -1_000_000);

  for (const [id, history] of [['ahead', 7_000_000], ['behind', -1_000_000]] as const) {
    const before = await balanceOf(id);
    const result = await recordBalanceBaseline(id);
    assert.equal(result.success, true, result.message);
    assert.equal(await balanceOf(id), before, 'the balance does not move');

    const rows = await rowsOf(id);
    assert.equal(rows.length, 2, 'exactly one row is added');
    const baseline = rows.find((r: any) => r.type === 'ADJUSTMENT')!;
    assert.equal(Number(baseline.amount), history);
    assert.equal(baseline.category, 'مانده پایه');
    assert.match(baseline.description!, /موجودی حساب تغییر نکرد/);

    const row = await rowOf(id);
    assert.equal(row.difference, 0);
    assert.equal(row.computed, before);

    // Once per account: refused, and nothing written.
    const again = await recordBalanceBaseline(id);
    assert.equal(again.success, false);
    assert.match(again.message!, /قبلاً ثبت شده/);
    assert.equal((await rowsOf(id)).length, 2);
  }
});

test('the baseline leaves exactly 0 where a floating-point sum would leave a remainder', async () => {
  // 0.1 + 0.2 is 0.30000000000000004 in floating point.
  await prisma.account.create({ data: { id: 'usd', name: 'حساب دلاری', type: 'BANK', currency: 'USD', balance: 1 } });
  for (const amount of [0.1, 0.2]) {
    await prisma.transaction.create({
      data: { type: 'INCOME', amount, amountInToman: amount * 100_000, currency: 'USD', accountId: 'usd' },
    });
  }
  assert.equal((await rowOf('usd')).difference, 0.7);

  const result = await recordBalanceBaseline('usd');
  assert.equal(result.success, true, result.message);
  const baseline = (await rowsOf('usd')).find((r: any) => r.type === 'ADJUSTMENT')!;
  assert.equal(baseline.amount.toString(), '0.7');
  assert.equal((await rowOf('usd')).difference, 0);
  assert.equal(await balanceOf('usd'), 1);
});

test('only an admin records a baseline or a bank check', async () => {
  await legacyAccount('bank', 7_000_000);
  for (const role of ['ACCOUNTANT', 'AUDITOR', 'SALES']) {
    setTestRole(role);
    assert.equal((await recordBalanceBaseline('bank')).message, ADMIN_ONLY, role);
    assert.equal((await recordBankCheck({ accountId: 'bank', bankBalance: 1 })).message, ADMIN_ONLY, role);
  }
  assert.equal(await prisma.transaction.count(), 1);
  assert.equal(await prisma.bankCheck.count(), 0);
});

test('an adjustment moves the balance to the bank figure, keeps the difference, and keeps the figure as a bank check', async () => {
  await legacyAccount('bank', 7_000_000);
  assert.equal((await recordBalanceBaseline('bank')).success, true);
  // Not baselined: the historical difference must survive the adjustment unchanged.
  await legacyAccount('old', 7_000_000);

  const adjusted = await adjustAccountBalance({ accountId: 'bank', targetBalance: 9_500_000, note: 'صورتحساب ۳۱ شهریور' });
  assert.equal(adjusted.success, true, adjusted.message);
  assert.equal(await balanceOf('bank'), 9_500_000);
  const correction = (await rowsOf('bank')).find((r: any) => r.category === 'اصلاح موجودی')!;
  assert.equal(Number(correction.amount), -500_000);
  assert.equal((await rowOf('bank')).difference, 0);

  const check = await prisma.bankCheck.findFirstOrThrow({ where: { accountId: 'bank' } });
  assert.equal(Number(check.bankBalance), 9_500_000);
  assert.equal(Number(check.erpBalance), 10_000_000, 'the ERP balance before the correction');
  assert.equal(check.note, 'صورتحساب ۳۱ شهریور');
  assert.equal(check.createdById, 'test-user');

  const shown = await rowOf('bank');
  assert.deepEqual(
    { bank: shown.lastCheck?.bankBalance, erp: shown.lastCheck?.erpBalance, since: shown.changeSinceCheck },
    { bank: 9_500_000, erp: 10_000_000, since: 0 },
    'the correction made with the check is not counted as entered since',
  );

  assert.equal((await adjustAccountBalance({ accountId: 'old', targetBalance: 12_000_000 })).success, true);
  assert.equal(await balanceOf('old'), 12_000_000);
  assert.equal((await rowOf('old')).difference, 7_000_000);

  // A figure that already matches: nothing moves, and the check is still kept.
  const same = await adjustAccountBalance({ accountId: 'bank', targetBalance: 9_500_000 });
  assert.equal(same.success, true, same.message);
  assert.equal((await rowsOf('bank')).length, 3);
  assert.equal(await prisma.bankCheck.count({ where: { accountId: 'bank' } }), 2);
});

test('a dollar account is corrected by cents too; only a Toman fraction under 0.5 counts as already right', async () => {
  await prisma.account.create({ data: { id: 'usd', name: 'حساب ذخیره دلاری', type: 'BANK', currency: 'USD', balance: 11_210.4 } });
  await prisma.transaction.create({
    data: { type: 'INCOME', amount: 11_210.4, amountInToman: 1_121_040_000, currency: 'USD', accountId: 'usd' },
  });

  // 40 cents is money on a dollar account, not a rounding of the figure shown.
  const adjusted = await adjustAccountBalance({ accountId: 'usd', targetBalance: 11_210 });
  assert.equal(adjusted.success, true, adjusted.message);
  assert.equal(await balanceOf('usd'), 11_210);
  const correction = (await rowsOf('usd')).find((r: any) => r.category === 'اصلاح موجودی')!;
  assert.equal(correction.amount.toString(), '-0.4');
  assert.equal((await rowOf('usd')).difference, 0);

  // On a Toman account the rounded figure the page shows is accepted as it is.
  await prisma.account.create({ data: { id: 'saman', name: 'بانک سامان', type: 'BANK', currency: 'TOMAN', balance: 55_268_771.9 } });
  const same = await adjustAccountBalance({ accountId: 'saman', targetBalance: 55_268_772 });
  assert.equal(same.success, true, same.message);
  assert.equal(await balanceOf('saman'), 55_268_771.9);
});

test('a sale booked while an adjustment runs keeps its increment', async () => {
  await prisma.account.create({ data: { id: 'bank', name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 10_000_000 } });
  await prisma.transaction.create({
    data: { type: 'INCOME', amount: 10_000_000, amountInToman: 10_000_000, currency: 'TOMAN', accountId: 'bank' },
  });

  // A website sale, written the way site-sale.ts writes one: its row and an increment.
  const bookSale = () =>
    prisma.$transaction(async (tx: any) => {
      await tx.transaction.create({
        data: { type: 'INCOME', amount: 1_000_000, amountInToman: 1_000_000, currency: 'TOMAN', accountId: 'bank' },
      });
      await tx.account.update({ where: { id: 'bank' }, data: { balance: { increment: 1_000_000 } } });
    });

  // The sale arrives after the adjustment has read the balance and before it writes.
  let sale: Promise<unknown> | null = null;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Transaction' || params.action !== 'create') return;
    beforeQuery.fn = null;
    sale = bookSale();
    // Give it the chance to finish first; with the account locked it has to wait.
    await Promise.race([sale, sleep(500)]);
  };

  const adjusted = await adjustAccountBalance({ accountId: 'bank', targetBalance: 12_000_000 });
  beforeQuery.fn = null;
  assert.equal(adjusted.success, true, adjusted.message);
  assert.ok(sale, 'the sale was started');
  await sale;

  assert.equal(await balanceOf('bank'), 13_000_000, 'the correction and the sale both count');
  assert.equal((await rowOf('bank')).difference, 0);
});

test('a bank check is stored and shown, and changes nothing else', async () => {
  // 3,000,000 of history the ledger cannot explain yet.
  await prisma.account.create({ data: { id: 'bank', name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 10_000_000 } });
  await prisma.transaction.create({
    data: { type: 'INCOME', amount: 7_000_000, amountInToman: 7_000_000, currency: 'TOMAN', accountId: 'bank' },
  });
  assert.equal((await rowOf('bank')).lastCheck, null);

  const checked = await recordBankCheck({ accountId: 'bank', bankBalance: 9_800_000, note: 'صورتحساب' });
  assert.equal(checked.success, true, checked.message);
  assert.equal(await balanceOf('bank'), 10_000_000);
  assert.equal(await prisma.transaction.count(), 1);
  assert.equal((await rowOf('bank')).difference, 3_000_000);

  const check = await prisma.bankCheck.findFirstOrThrow({ where: { accountId: 'bank' } });
  assert.equal(Number(check.bankBalance), 9_800_000);
  assert.equal(Number(check.erpBalance), 10_000_000);
  assert.equal(check.note, 'صورتحساب');
  assert.equal(check.createdById, 'test-user');

  // Money entered after the check is what the bank should have moved by since;
  // a baseline recorded after it moves no money and is not part of that.
  await sleep(20);
  const deposit = await recordDeposit(undefined, form({ amount: '500000', currency: 'TOMAN', accountId: 'bank', description: 'واریز' }));
  assert.equal(deposit.success, true, deposit.message);
  assert.equal((await recordBalanceBaseline('bank')).success, true);

  const row = await rowOf('bank');
  assert.deepEqual(
    { ...row.lastCheck, checkedAt: undefined },
    { checkedAt: undefined, bankBalance: 9_800_000, erpBalance: 10_000_000, note: 'صورتحساب' },
  );
  assert.equal(row.changeSinceCheck, 500_000);
  assert.equal(row.difference, 0);

  // The newest check is the one shown.
  await sleep(20);
  assert.equal((await recordBankCheck({ accountId: 'bank', bankBalance: 10_300_000 })).success, true);
  const latest = await rowOf('bank');
  assert.equal(latest.lastCheck?.bankBalance, 10_300_000);
  assert.equal(latest.lastCheck?.erpBalance, 10_500_000);
  assert.equal(latest.changeSinceCheck, 0);

  assert.equal((await recordBankCheck({ accountId: 'bank', bankBalance: Number.NaN })).success, false);
  assert.equal(await prisma.bankCheck.count(), 2);
});

test('the correction dialog asks twice for a large change or a figure about 10 times the balance', () => {
  // A Rial figure typed as Toman (Saman: 552,687,719 Rial is 55,268,772 Toman).
  assert.match(adjustmentWarning(55_268_772, 552_687_719, 'TOMAN')!, /ریال/);
  assert.match(adjustmentWarning(3_878_346, 38_783_460, 'TOMAN')!, /ریال/);
  // The same figure against what the ERP actually shows for Saman today (69,634,000): the ERP is off
  // too, so the typed figure is 7.9 times the balance, not exactly 10.
  assert.match(adjustmentWarning(69_634_000, 552_687_719, 'TOMAN')!, /ریال/);
  // Three times the balance is a large change, not a Rial figure.
  assert.doesNotMatch(adjustmentWarning(10_000_000, 30_000_000, 'TOMAN')!, /ریال/);
  assert.doesNotMatch(adjustmentWarning(100, 1_000, 'USD')!, /ریال/);
  // More than 10,000,000.
  assert.ok(adjustmentWarning(69_634_000, 55_268_772, 'TOMAN'));
  // More than 10% of the balance.
  assert.ok(adjustmentWarning(1_569_900, 0, 'TOMAN'));
  assert.ok(adjustmentWarning(500_000, 560_000, 'TOMAN'));
  // Small corrections go through with one confirmation.
  assert.equal(adjustmentWarning(46_778_800, 46_546_102, 'TOMAN'), null);
  assert.equal(adjustmentWarning(500_000, 540_000, 'TOMAN'), null);
  assert.equal(adjustmentWarning(11_210, 10_500, 'USD'), null);
});
