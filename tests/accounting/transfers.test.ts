import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { AccessDenied } from '@/lib/access';
import {
  deleteInternalTransfer,
  getInternalTransfers,
  recordInternalTransfer,
  updateInternalTransfer,
} from '@/actions/accounting';
import { balanceOf, driftOf, openAccount } from './ledger';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const ADMIN_ONLY = 'دسترسی غیرمجاز — فقط مدیر سیستم می‌تواند این عملیات را انجام دهد.';

beforeEach(async () => {
  setTestRole('ADMIN');
  beforeQuery.fn = null;
  await resetDatabase();
  await openAccount('novin', 100_000_000);
  await openAccount('dehghani', 200_000_000);
  await openAccount('saman', 50_000_000);
  await openAccount('usd', 1_000, 'USD');
});
after(() => prisma.$disconnect());

const balances = async () => ({
  novin: await balanceOf('novin'),
  dehghani: await balanceOf('dehghani'),
  saman: await balanceOf('saman'),
});

async function assertLedgersAddUp() {
  for (const id of ['novin', 'dehghani', 'saman', 'usd']) assert.equal(await driftOf(id), 0, `${id} drifted`);
}

async function transfer(amount: number, from = 'novin', to = 'dehghani', description = 'جهت خرید دلار') {
  const result = await recordInternalTransfer(
    undefined,
    form({ amount: String(amount), fromAccountId: from, toAccountId: to, description, date: '2026-09-21' }),
  );
  assert.equal(result.success, true, result.message);
}

/** A leg exactly as the app wrote it before transferGroupId existed. */
function legacyLeg(accountId: string, prefix: '[خروج]' | '[ورود]', amount: number, createdAt: Date, text = 'انتقال قدیمی') {
  return prisma.transaction.create({
    data: {
      type: 'TRANSFER',
      amount,
      amountInToman: amount,
      currency: 'TOMAN',
      accountId,
      category: 'انتقال وجه',
      description: `${prefix} ${text}`,
      date: new Date('2026-09-10'),
      createdAt,
    },
  });
}

/** Books a legacy transfer's legs and moves the balances the way the old code did. */
async function legacyTransfer(from: string, to: string, amount: number, createdAt: Date, text?: string) {
  await legacyLeg(from, '[خروج]', amount, createdAt, text);
  await legacyLeg(to, '[ورود]', amount, new Date(createdAt.getTime() + 3), text);
  await prisma.account.update({ where: { id: from }, data: { balance: { decrement: amount } } });
  await prisma.account.update({ where: { id: to }, data: { balance: { increment: amount } } });
}

test('a transfer writes both legs with one transferGroupId and moves both balances', async () => {
  await transfer(43_810_000);

  const legs = await prisma.transaction.findMany({ where: { type: 'TRANSFER' }, orderBy: { description: 'asc' } });
  assert.equal(legs.length, 2);
  assert.ok(legs[0].transferGroupId, 'the legs are linked');
  assert.equal(legs[0].transferGroupId, legs[1].transferGroupId);
  assert.deepEqual(await balances(), { novin: 56_190_000, dehghani: 243_810_000, saman: 50_000_000 });
  await assertLedgersAddUp();
});

test('the transfers page lists each transfer once, from its two legs', async () => {
  await transfer(43_810_000);
  await transfer(1_000_000, 'saman', 'novin', 'جابجایی');

  const listed = await getInternalTransfers();
  assert.equal(listed.length, 2);
  const big = listed.find((row) => row.amount === 43_810_000)!;
  assert.equal(big.complete, true);
  assert.equal(big.fromAccountId, 'novin');
  assert.equal(big.toAccountId, 'dehghani');
  assert.equal(big.fromAccount, 'حساب novin');
  assert.equal(big.currency, 'TOMAN');
  assert.equal(big.description, 'جهت خرید دلار', 'shown without the «[خروج]» prefix');
  const small = listed.find((row) => row.amount === 1_000_000)!;
  assert.equal(small.fromAccountId, 'saman');
  assert.equal(small.toAccountId, 'novin');

  // Reading the list takes finance.view, like the journal.
  setTestRole('AUDITOR');
  assert.equal((await getInternalTransfers()).length, 2);
  setTestRole('SALES');
  await assert.rejects(getInternalTransfers(), (error: unknown) => error instanceof AccessDenied);
});

test('a transfer recorded before transferGroupId is paired by prefix, amount and time, then edited and deleted', async () => {
  const at = new Date('2026-09-10T10:00:00Z');
  await legacyTransfer('novin', 'dehghani', 5_000_000, at, 'اول');
  // The same amount again 1.7 s later (a second click), and once more a minute later.
  await legacyTransfer('novin', 'dehghani', 5_000_000, new Date(at.getTime() + 1_700), 'دوم');
  await legacyTransfer('novin', 'dehghani', 5_000_000, new Date(at.getTime() + 60_000), 'سوم');
  // A lone leg with nothing beside it.
  await legacyLeg('saman', '[ورود]', 7_000_000, new Date(at.getTime() + 120_000), 'تنها');
  await prisma.account.update({ where: { id: 'saman' }, data: { balance: { increment: 7_000_000 } } });
  await assertLedgersAddUp();

  const listed = await getInternalTransfers();
  assert.equal(listed.length, 4);
  for (const text of ['اول', 'دوم', 'سوم']) {
    const row = listed.find((r) => r.description === text)!;
    assert.equal(row.complete, true, text);
    assert.equal(row.fromAccountId, 'novin', text);
    assert.equal(row.toAccountId, 'dehghani', text);
  }
  const lone = listed.find((r) => r.description === 'تنها')!;
  assert.equal(lone.complete, false);
  assert.equal(lone.fromAccountId, null);

  // Correct the second one (it never happened at the bank) by removing it.
  const second = listed.find((r) => r.description === 'دوم')!;
  const removed = await deleteInternalTransfer(second.id);
  assert.equal(removed.success, true, removed.message);
  assert.equal(await balanceOf('novin'), 100_000_000 - 10_000_000);
  assert.equal(await balanceOf('dehghani'), 200_000_000 + 10_000_000);
  assert.equal((await getInternalTransfers()).find((r) => r.description === 'دوم'), undefined);

  // Correct the first one's amount: the legs are rewritten and linked from now on.
  const first = (await getInternalTransfers()).find((r) => r.description === 'اول')!;
  const fixed = await updateInternalTransfer({
    id: first.id,
    fromAccountId: 'novin',
    toAccountId: 'dehghani',
    amount: 4_000_000,
    description: 'اول',
  });
  assert.equal(fixed.success, true, fixed.message);
  assert.equal(await balanceOf('novin'), 100_000_000 - 9_000_000);
  assert.equal(await balanceOf('dehghani'), 200_000_000 + 9_000_000);
  const relinked = await prisma.transaction.findMany({ where: { description: { endsWith: 'اول' } } });
  assert.equal(relinked.length, 2, 'the old legs are rewritten, not duplicated');
  assert.ok(relinked[0].transferGroupId && relinked[0].transferGroupId === relinked[1].transferGroupId);

  // The lone leg can be removed too, and takes its money back.
  assert.equal((await deleteInternalTransfer(lone.id)).success, true);
  assert.equal(await balanceOf('saman'), 50_000_000);
  await assertLedgersAddUp();
});

test('a transfer booked through the API (TRANSFER out, INCOME in, linked) is listed and removed as one', async () => {
  const transferGroupId = 'api-transfer-1';
  await prisma.transaction.create({
    data: {
      type: 'TRANSFER', amount: 2_000_000, amountInToman: 2_000_000, currency: 'TOMAN', accountId: 'novin',
      category: 'انتقال داخلی', description: 'انتقال به حساب dehghani', transferGroupId,
    },
  });
  await prisma.transaction.create({
    data: {
      type: 'INCOME', amount: 2_000_000, amountInToman: 2_000_000, currency: 'TOMAN', accountId: 'dehghani',
      category: 'انتقال داخلی', description: 'انتقال از حساب novin', transferGroupId,
    },
  });
  await prisma.account.update({ where: { id: 'novin' }, data: { balance: { decrement: 2_000_000 } } });
  await prisma.account.update({ where: { id: 'dehghani' }, data: { balance: { increment: 2_000_000 } } });

  const [row] = await getInternalTransfers();
  assert.equal(row.id, transferGroupId);
  assert.equal(row.fromAccountId, 'novin');
  assert.equal(row.toAccountId, 'dehghani');
  assert.equal(row.complete, true);

  const removed = await deleteInternalTransfer(row.id);
  assert.equal(removed.success, true, removed.message);
  assert.deepEqual(await balances(), { novin: 100_000_000, dehghani: 200_000_000, saman: 50_000_000 });
  await assertLedgersAddUp();
});

test('editing a transfer moves the balances to what it should have been', async () => {
  await transfer(43_810_000);
  const [recorded] = await getInternalTransfers();

  // The money actually went from Saman, and was 43,800,000.
  const fixed = await updateInternalTransfer({
    id: recorded.id,
    fromAccountId: 'saman',
    toAccountId: 'dehghani',
    amount: 43_800_000,
    date: '2026-09-20',
    description: 'اصلاح شد',
  });
  assert.equal(fixed.success, true, fixed.message);
  assert.deepEqual(await balances(), { novin: 100_000_000, dehghani: 243_800_000, saman: 6_200_000 });

  const listed = await getInternalTransfers();
  assert.equal(listed.length, 1, 'the same document, not a second one');
  assert.equal(listed[0].id, recorded.id);
  assert.equal(listed[0].amount, 43_800_000);
  assert.equal(listed[0].fromAccountId, 'saman');
  assert.equal(listed[0].description, 'اصلاح شد');
  assert.equal(await prisma.transaction.count({ where: { type: 'TRANSFER' } }), 2);
  await assertLedgersAddUp();
});

test('an edit the source cannot cover, or across currencies, changes nothing', async () => {
  await transfer(10_000_000);
  const before = await balances();
  const [recorded] = await getInternalTransfers();

  const tooMuch = await updateInternalTransfer({ id: recorded.id, fromAccountId: 'saman', toAccountId: 'novin', amount: 60_000_000 });
  assert.equal(tooMuch.success, false);
  assert.match(tooMuch.message!, /کافی نیست/);

  const crossCurrency = await updateInternalTransfer({ id: recorded.id, fromAccountId: 'novin', toAccountId: 'usd', amount: 1 });
  assert.equal(crossCurrency.success, false);
  assert.match(crossCurrency.message!, /ارز دو حساب/);

  assert.deepEqual(await balances(), before);
  assert.equal((await getInternalTransfers())[0].amount, 10_000_000);
  await assertLedgersAddUp();
});

test('deleting a transfer gives both accounts their money back and removes both legs', async () => {
  await transfer(43_810_000);
  const [recorded] = await getInternalTransfers();

  const removed = await deleteInternalTransfer(recorded.id);
  assert.equal(removed.success, true, removed.message);
  assert.deepEqual(await balances(), { novin: 100_000_000, dehghani: 200_000_000, saman: 50_000_000 });
  assert.equal(await prisma.transaction.count({ where: { type: 'TRANSFER' } }), 0);
  assert.deepEqual(await getInternalTransfers(), []);

  // Another row's id is not a transfer.
  const expense = await prisma.transaction.findFirstOrThrow({ where: { accountId: 'saman' } });
  const refused = await deleteInternalTransfer(expense.id);
  assert.equal(refused.success, false);
  assert.equal(await prisma.transaction.count({ where: { id: expense.id } }), 1);
  await assertLedgersAddUp();
});

test('only the admin may edit or delete a recorded transfer', async () => {
  await transfer(10_000_000);
  const before = await balances();
  const [recorded] = await getInternalTransfers();

  for (const role of ['ACCOUNTANT', 'AUDITOR', 'SALES', 'WAREHOUSE', null]) {
    setTestRole(role);
    const edit = await updateInternalTransfer({ id: recorded.id, fromAccountId: 'novin', toAccountId: 'saman', amount: 1 });
    assert.equal(edit.success, false, String(role));
    assert.equal(edit.message, ADMIN_ONLY, String(role));
    const remove = await deleteInternalTransfer(recorded.id);
    assert.equal(remove.success, false, String(role));
    assert.equal(remove.message, ADMIN_ONLY, String(role));
  }

  setTestRole('ADMIN');
  assert.deepEqual(await balances(), before);
  assert.equal(await prisma.transaction.count({ where: { type: 'TRANSFER' } }), 2);
});

test('two deletes of the same transfer at the same moment reverse it once', async () => {
  await transfer(10_000_000);
  const [recorded] = await getInternalTransfers();

  // The second delete starts while the first is between reading the legs and reversing them.
  let second = null as Promise<any> | null;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Account' || params.action !== 'update') return;
    beforeQuery.fn = null;
    second = deleteInternalTransfer(recorded.id);
    await Promise.race([second, sleep(500)]);
  };
  const first = await deleteInternalTransfer(recorded.id);
  beforeQuery.fn = null;
  assert.ok(second, 'the second delete was started');
  const other = await second!;

  assert.deepEqual([first.success, other.success].sort(), [false, true]);
  assert.deepEqual(await balances(), { novin: 100_000_000, dehghani: 200_000_000, saman: 50_000_000 });
  await assertLedgersAddUp();
});

test('a legacy leg is paired with the leg written beside it, and a lone leg is removed alone', async () => {
  const at = new Date('2026-09-10T10:00:00Z');
  // A whole transfer, with a lone incoming leg of the same amount a second before it and one a second after it.
  await legacyLeg('saman', '[ورود]', 5_000_000, new Date(at.getTime() - 1_000), 'تنها قبل');
  await legacyTransfer('novin', 'dehghani', 5_000_000, at, 'کامل');
  await legacyLeg('saman', '[ورود]', 5_000_000, new Date(at.getTime() + 1_000), 'تنها بعد');
  await prisma.account.update({ where: { id: 'saman' }, data: { balance: { increment: 10_000_000 } } });
  await assertLedgersAddUp();

  const listed = await getInternalTransfers();
  assert.equal(listed.length, 3);
  const whole = listed.find((r) => r.description === 'کامل')!;
  assert.equal(whole.complete, true);
  assert.equal(whole.fromAccountId, 'novin');
  assert.equal(whole.toAccountId, 'dehghani');
  for (const text of ['تنها قبل', 'تنها بعد']) {
    const lone = listed.find((r) => r.description === text)!;
    assert.equal(lone.complete, false, text);
    assert.equal(lone.toAccountId, 'saman', text);
  }

  // Removing a lone leg takes back only its own money; the whole transfer beside it stays as listed.
  for (const text of ['تنها بعد', 'تنها قبل']) {
    const lone = (await getInternalTransfers()).find((r) => r.description === text)!;
    const removed = await deleteInternalTransfer(lone.id);
    assert.equal(removed.success, true, removed.message);
  }
  assert.deepEqual(await balances(), { novin: 95_000_000, dehghani: 205_000_000, saman: 50_000_000 });
  const left = await getInternalTransfers();
  assert.equal(left.length, 1);
  assert.equal(left[0].description, 'کامل');
  assert.equal(left[0].complete, true);
  await assertLedgersAddUp();
});
