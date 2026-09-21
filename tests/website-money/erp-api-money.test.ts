import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase } from '../helpers/db';
import { POST } from '@/app/api/erp/route';
import { DUPLICATE_REQUEST_MESSAGE } from '@/lib/request-id';
import { balanceEffect } from '@/lib/balance-reconciliation';

// /api/erp money writes (report fix #10): deposit, expense and transfer.

console.error = () => {};

const TOKEN = 'erp-api-money-token';
const SITE_TOKEN = 'erp-api-money-site-token';
const USD_RATE = 92_000;

const OPENING = { toman: 10_000_000, other: 0, usd: 1_000 };

beforeEach(async () => {
  process.env.ERP_API_SECRET = TOKEN;
  process.env.ERP_SITE_API_SECRET = SITE_TOKEN;
  await resetDatabase();
  await prisma.account.createMany({
    data: [
      { id: 'toman', name: 'اقتصاد نوین', type: 'BANK', currency: 'TOMAN', balance: OPENING.toman },
      { id: 'other', name: 'اقتصادنوین-دهقانی', type: 'BANK', currency: 'TOMAN', balance: OPENING.other },
      { id: 'usd', name: 'حساب ذخیره دلاری', type: 'BANK', currency: 'USD', balance: OPENING.usd },
    ],
  });
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: USD_RATE, date: new Date('2026-09-01') } });
});
after(() => prisma.$disconnect());

async function post(body: Record<string, unknown>, token = TOKEN) {
  const res = await POST(
    new NextRequest('http://localhost/api/erp', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

const balanceOf = async (id: string) => Number((await prisma.account.findUniqueOrThrow({ where: { id } })).balance);

/** Account.balance == opening + what its rows did, for every account. */
async function assertLedgers() {
  for (const [id, opening] of Object.entries(OPENING)) {
    const account = await prisma.account.findUniqueOrThrow({ where: { id }, include: { transactions: true } });
    const derived = opening + account.transactions.reduce((sum: number, t: any) => sum + balanceEffect(t), 0);
    assert.ok(Math.abs(Number(account.balance) - derived) < 1e-9, `${id}: ${Number(account.balance)} vs ${derived}`);
  }
}

test('an amount of zero, below zero or not a number is 422, and nothing is written', async () => {
  for (const amount of [0, -500, 'abc', true]) {
    for (const body of [
      { action: 'deposit', accountId: 'toman', amount, description: 'x' },
      { action: 'expense', accountId: 'toman', amount, description: 'x' },
      { action: 'transfer', fromAccountId: 'toman', toAccountId: 'other', amount },
    ]) {
      const res = await post(body);
      assert.equal(res.status, 422, `${body.action} ${String(amount)}`);
      assert.match(res.body.error, /amount/);
    }
  }
  // A missing field is still 400.
  assert.equal((await post({ action: 'deposit', accountId: 'toman', description: 'x' })).status, 400);
  assert.equal(await prisma.transaction.count(), 0);
  assert.equal(await balanceOf('toman'), OPENING.toman);
});

test('a Jalali-looking or pre-1900 date is 422 with a clear message', async () => {
  for (const date of ['1405-06-30', '1404/12/07', '1899-12-31', 'yesterday', 20260921]) {
    for (const body of [
      { action: 'deposit', accountId: 'toman', amount: 1000, description: 'x', date },
      { action: 'expense', accountId: 'toman', amount: 1000, description: 'x', date },
      { action: 'transfer', fromAccountId: 'toman', toAccountId: 'other', amount: 1000, date },
    ]) {
      const res = await post(body);
      assert.equal(res.status, 422, `${body.action} ${date}`);
      assert.match(res.body.error, /date/);
    }
  }
  assert.match((await post({ action: 'deposit', accountId: 'toman', amount: 1, description: 'x', date: '1405-06-30' })).body.error, /Jalali/);
  assert.equal(await prisma.transaction.count(), 0);

  const ok = await post({ action: 'deposit', accountId: 'toman', amount: 1000, description: 'x', date: '2026-09-21' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.transactions[0].date, '2026-09-21T00:00:00.000Z');
});

test('without a currency the amount is in the account’s own currency, not Toman', async () => {
  const res = await post({ action: 'deposit', accountId: 'usd', amount: 500, description: 'فروش دلاری' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(await balanceOf('usd'), OPENING.usd + 500);
  const [row] = res.body.transactions;
  assert.deepEqual(
    [row.accountId, row.type, row.amount, row.currency, row.amountInToman, row.balance],
    ['usd', 'INCOME', 500, 'USD', 500 * USD_RATE, OPENING.usd + 500],
  );

  // An explicit Toman amount into the dollar account is converted.
  const toman = await post({ action: 'expense', accountId: 'usd', amount: 9_200_000, currency: 'TOMAN', description: 'x' });
  assert.equal(toman.status, 200, JSON.stringify(toman.body));
  assert.equal(toman.body.transactions[0].amount, 100);
  assert.equal(await balanceOf('usd'), OPENING.usd + 500 - 100);

  // And a Toman account without a currency stays Toman.
  const plain = await post({ action: 'expense', accountId: 'toman', amount: 632_200, description: 'ناهار' });
  assert.deepEqual([plain.body.transactions[0].amount, plain.body.transactions[0].currency], [632_200, 'TOMAN']);
  assert.equal((await post({ action: 'deposit', accountId: 'toman', amount: 1, currency: 'GBP', description: 'x' })).status, 422);
  await assertLedgers();
});

test('the reply names the booked rows, the amount, the currency and each account’s new balance', async () => {
  const deposit = await post({ action: 'deposit', accountId: 'toman', amount: 2_500_000, currency: 'TOMAN', description: 'x' });
  assert.equal(deposit.status, 200);
  assert.equal(deposit.body.success, true);
  const [row] = deposit.body.transactions;
  const stored = await prisma.transaction.findUniqueOrThrow({ where: { id: row.id } });
  assert.deepEqual([stored.accountId, Number(stored.amount)], ['toman', 2_500_000]);
  assert.equal(row.balance, OPENING.toman + 2_500_000);

  const transfer = await post({ action: 'transfer', fromAccountId: 'toman', toAccountId: 'other', amount: 1_000_000, currency: 'TOMAN' });
  assert.equal(transfer.status, 200, JSON.stringify(transfer.body));
  const [out, into] = transfer.body.transactions;
  assert.deepEqual([out.accountId, out.type, out.amount, out.balance], ['toman', 'TRANSFER', 1_000_000, OPENING.toman + 1_500_000]);
  assert.deepEqual([into.accountId, into.type, into.amount, into.balance], ['other', 'INCOME', 1_000_000, 1_000_000]);
  const legs = await prisma.transaction.findMany({ where: { id: { in: [out.id, into.id] } } });
  assert.ok(legs[0].transferGroupId && legs[0].transferGroupId === legs[1].transferGroupId, 'both legs share one transfer id');
  await assertLedgers();
});

test('the same requestId books once, and a repeat answers with the first rows', async () => {
  const body = { action: 'expense', accountId: 'toman', amount: 632_200, currency: 'TOMAN', description: 'Other - ناهار', requestId: 'mcp-call-00000001' };
  const first = await post(body);
  const second = await post(body);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.message, DUPLICATE_REQUEST_MESSAGE);
  assert.equal(second.body.transactions[0].id, first.body.transactions[0].id);
  assert.equal(await prisma.transaction.count(), 1);
  assert.equal(await balanceOf('toman'), OPENING.toman - 632_200);

  // Sent twice at once, still once.
  const deposit = { action: 'deposit', accountId: 'other', amount: 43_810_000, currency: 'TOMAN', description: 'x', requestId: 'mcp-call-00000002' };
  const both = await Promise.all([post(deposit), post(deposit)]);
  assert.deepEqual(both.map((r) => r.status), [200, 200]);
  assert.equal(await balanceOf('other'), 43_810_000);

  const transfer = { action: 'transfer', fromAccountId: 'other', toAccountId: 'toman', amount: 1_000, currency: 'TOMAN', requestId: 'mcp-call-00000003' };
  const t1 = await post(transfer);
  const t2 = await post(transfer);
  assert.equal(t2.body.duplicate, true);
  assert.deepEqual(t2.body.transactions.map((t: any) => t.id), t1.body.transactions.map((t: any) => t.id));
  assert.equal(await prisma.transaction.count({ where: { type: 'TRANSFER' } }), 1);

  // A repeat after the account can no longer cover it is still the first entry, not a refusal.
  const all = { action: 'expense', accountId: 'toman', amount: OPENING.toman - 632_200 + 1_000, currency: 'TOMAN', description: 'x', requestId: 'mcp-call-00000004' };
  assert.equal((await post(all)).status, 200);
  const repeat = await post(all);
  assert.deepEqual([repeat.status, repeat.body.duplicate, repeat.body.transactions[0].balance], [200, true, 0]);
  await assertLedgers();
});

test('a transfer description starting with «[ورود]» cannot make the outgoing leg read as incoming', async () => {
  const res = await post({ action: 'transfer', fromAccountId: 'toman', toAccountId: 'other', amount: 4_381_000, currency: 'TOMAN', description: '[ورود] [ورود] جهت خرید دلار' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const out = await prisma.transaction.findUniqueOrThrow({ where: { id: res.body.transactions[0].id } });
  assert.equal(out.description, 'جهت خرید دلار');
  assert.equal(balanceEffect(out), -4_381_000);

  const plain = await post({ action: 'transfer', fromAccountId: 'other', toAccountId: 'toman', amount: 1, currency: 'TOMAN', description: '[ورود]' });
  const back = await prisma.transaction.findUniqueOrThrow({ where: { id: plain.body.transactions[0].id } });
  assert.equal(back.description, 'انتقال به اقتصاد نوین');
  await assertLedgers();
});

test('a transfer currency that is not the accounts’ is 422', async () => {
  const res = await post({ action: 'transfer', fromAccountId: 'toman', toAccountId: 'other', amount: 1_000, currency: 'USD' });
  assert.equal(res.status, 422);
  assert.equal(await prisma.transaction.count(), 0);
});

test('the site key still cannot reach any money write', async () => {
  for (const body of [
    { action: 'deposit', accountId: 'toman', amount: 500, description: 'x', requestId: 'site-call-0000001' },
    { action: 'expense', accountId: 'toman', amount: -500, description: 'x' },
    { action: 'transfer', fromAccountId: 'toman', toAccountId: 'other', amount: 500 },
  ]) {
    assert.equal((await post(body, SITE_TOKEN)).status, 403, body.action);
  }
  assert.equal(await prisma.transaction.count(), 0);
});
