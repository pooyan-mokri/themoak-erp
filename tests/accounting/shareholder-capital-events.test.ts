import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { AccessDenied } from '@/lib/access';
import {
  depositShareholderFunds,
  getShareholderBalance,
  getShareholderCapitalEvents,
  withdrawShareholderFunds,
} from '@/actions/shareholder';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/**
 * The shareholders page lists the capital deposits and withdrawals one by one:
 * exactly the rows the balance tab adds up, and nothing else a shareholder id
 * is on (a profit payout is profit data, shown only on the profits page).
 */
test('capital events are the deposits and withdrawals the balance adds up, newest first', async () => {
  const bank = await prisma.account.create({ data: { name: 'Bank', type: 'BANK', currency: 'TOMAN', balance: 100_000_000 } });
  const ali = await prisma.shareholder.create({ data: { name: 'Ali', percentage: 60 } });

  const deposited = await depositShareholderFunds(
    undefined,
    form({ shareholderId: ali.id, accountId: bank.id, amount: '5000000', currency: 'TOMAN', date: '2026-01-10' }),
  );
  assert.equal(deposited.success, true, deposited.message);
  const withdrawn = await withdrawShareholderFunds(
    undefined,
    form({ shareholderId: ali.id, accountId: bank.id, amount: '1200000', currency: 'TOMAN', date: '2026-02-10' }),
  );
  assert.equal(withdrawn.success, true, withdrawn.message);
  // A profit payout carries the shareholder too, but it is not a capital event.
  await prisma.transaction.create({
    data: {
      type: 'EXPENSE', amount: 900_000, amountInToman: 900_000, currency: 'TOMAN',
      accountId: bank.id, shareholderId: ali.id, category: 'Shareholder Profit Withdrawal',
    },
  });

  const events = await getShareholderCapitalEvents();
  assert.deepEqual(
    events.map((e) => [e.kind, e.shareholderName, e.amountInToman, e.accountName]),
    [
      ['withdrawal', 'Ali', 1_200_000, 'Bank'],
      ['deposit', 'Ali', 5_000_000, 'Bank'],
    ],
  );
  const net = events.reduce((sum, e) => sum + (e.kind === 'deposit' ? e.amountInToman : -e.amountInToman), 0);
  assert.equal(net, await getShareholderBalance(ali.id));
});

test('capital events need finance.view', async () => {
  for (const role of ['SALES', 'WAREHOUSE', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    await assert.rejects(getShareholderCapitalEvents(), (error: unknown) => error instanceof AccessDenied, String(role));
  }
  for (const role of ['ADMIN', 'AUDITOR', 'ACCOUNTANT']) {
    setTestRole(role);
    assert.deepEqual(await getShareholderCapitalEvents(), [], role);
  }
});
