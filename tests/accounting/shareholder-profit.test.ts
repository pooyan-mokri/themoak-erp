import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { withdrawShareholderFunds } from '@/actions/shareholder';
import { withdrawShareholderProfit } from '@/actions/shareholder-profit';
import { withdrawalActionFor } from '@/components/accounting/shareholder-withdrawal-form';
import { balanceOf, driftOf, openAccount } from './ledger';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

let profit: { id: string; shareholderId: string };

beforeEach(async () => {
  setTestRole('ADMIN');
  beforeQuery.fn = null;
  await resetDatabase();
  await openAccount('bank', 100_000_000);
  const shareholder = await prisma.shareholder.create({ data: { name: 'Ali', percentage: 100 } });
  profit = await prisma.shareholderProfit.create({
    data: {
      shareholderId: shareholder.id,
      amount: 1_000_000,
      withdrawn: 0,
      periodStart: new Date('2026-08-23'),
      periodEnd: new Date('2026-09-21'),
    },
  });
});
after(() => prisma.$disconnect());

/** What the profit dialog's form sends. */
const dialogFields = () =>
  form({
    shareholderId: profit.shareholderId,
    profitId: profit.id,
    accountId: 'bank',
    amount: '1000000',
    date: '',
    description: '',
  });

const withdrawnOf = async () =>
  Number((await prisma.shareholderProfit.findUniqueOrThrow({ where: { id: profit.id } })).withdrawn);

test('the profit dialog pays out through withdrawShareholderProfit; the capital form does not', () => {
  assert.equal(withdrawalActionFor({ id: 'a-profit' }), withdrawShareholderProfit);
  assert.equal(withdrawalActionFor(undefined), withdrawShareholderFunds);
});

test('a profit paid from the dialog is marked withdrawn and cannot be paid a second time', async () => {
  const pay = withdrawalActionFor(profit);

  const paid = await pay(undefined as any, dialogFields());
  assert.equal(paid.success, true, paid.message);
  assert.equal(await withdrawnOf(), 1_000_000);
  assert.equal(await balanceOf('bank'), 99_000_000);

  const again = await pay(undefined as any, dialogFields());
  assert.equal(again.success, false);
  assert.match(again.message!, /بیشتر از سود قابل برداشت/);
  assert.equal(await withdrawnOf(), 1_000_000);
  assert.equal(await balanceOf('bank'), 99_000_000);
  assert.equal(await prisma.shareholderWithdrawal.count(), 1);
  assert.equal(await driftOf('bank'), 0);
});

test('two payouts of the same profit at the same moment pay it once', async () => {
  // The second payout arrives after the first has checked the profit and before it has marked it.
  let second = null as Promise<any> | null;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Transaction' || params.action !== 'create') return;
    beforeQuery.fn = null;
    second = withdrawShareholderProfit(undefined as any, dialogFields());
    await Promise.race([second, sleep(500)]);
  };
  const first = await withdrawShareholderProfit(undefined as any, dialogFields());
  beforeQuery.fn = null;
  assert.ok(second, 'the second payout was started');
  const other = await second!;

  assert.deepEqual([first.success, other.success].sort(), [false, true]);
  assert.equal(await withdrawnOf(), 1_000_000);
  assert.equal(await balanceOf('bank'), 99_000_000);
  assert.equal(await prisma.shareholderWithdrawal.count(), 1);
});
