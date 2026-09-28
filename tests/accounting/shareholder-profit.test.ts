import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setTimeout as sleep } from 'node:timers/promises';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { withdrawShareholderFunds } from '@/actions/shareholder';
import { calculateShareholderProfits, getShareholderProfitById, getShareholderProfits, withdrawShareholderProfit } from '@/actions/shareholder-profit';
import { withdrawalActionFor } from '@/components/accounting/shareholder-withdrawal-form';
import { ShareholderProfitList } from '@/components/accounting/shareholder-profit-list';
import { profitPeriods } from '@/lib/profit-periods';
import { balanceOf, driftOf, openAccount } from './ledger';

(globalThis as any).React = React;

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

// ─── Calculating a period's profit, and paying it out ────────────────────────

const period = (periodStart: string, periodEnd: string) => form({ periodStart, periodEnd, description: '' });
const sale = (date: string, amount: number) =>
  prisma.transaction.create({ data: { type: 'INCOME', amount, amountInToman: amount, category: 'Sales', date: new Date(date) } });

test('a period\'s profit is split by share; a period that overlaps one already calculated is refused', async () => {
  await prisma.shareholderProfit.deleteMany();
  await prisma.shareholder.update({ where: { id: profit.shareholderId }, data: { percentage: 60 } });
  await prisma.shareholder.create({ data: { name: 'Reza', percentage: 40 } });
  await sale('2026-10-05T08:00:00Z', 10_000_000);
  await prisma.transaction.create({ data: { type: 'EXPENSE', amount: 2_500_000, amountInToman: 2_500_000, category: 'اجاره', date: new Date('2026-10-06T08:00:00Z') } });

  const calculated = await calculateShareholderProfits(undefined, period('2026-10-01', '2026-10-31'));
  assert.equal(calculated.success, true, calculated.message);
  assert.match(calculated.message!, /۷٬۵۰۰٬۰۰۰/);
  const profits = await getShareholderProfits();
  assert.deepEqual(profits.map((p: any) => [p.shareholder.name, p.amount, p.withdrawn, p.available]).sort(), [
    ['Ali', 4_500_000, 0, 4_500_000],
    ['Reza', 3_000_000, 0, 3_000_000],
  ]);
  assert.equal((await getShareholderProfits(profit.shareholderId)).length, 1);

  const overlap = await calculateShareholderProfits(undefined, period('2026-10-31', '2026-11-30'));
  assert.match(overlap.message!, /قبلاً سود محاسبه شده/);
  assert.equal(await prisma.shareholderProfit.count(), 2);
});

test('a period with no profit, no shareholders or no shares is refused and writes nothing', async () => {
  await prisma.shareholderProfit.deleteMany();
  await prisma.transaction.create({ data: { type: 'EXPENSE', amount: 1_000, amountInToman: 1_000, category: 'اجاره', date: new Date('2026-10-06T08:00:00Z') } });
  assert.match((await calculateShareholderProfits(undefined, period('2026-10-01', '2026-10-31'))).message!, /سود محاسبه نشده/);

  await sale('2026-11-05T08:00:00Z', 5_000_000);
  await prisma.shareholder.update({ where: { id: profit.shareholderId }, data: { percentage: 0 } });
  assert.match((await calculateShareholderProfits(undefined, period('2026-11-01', '2026-11-30'))).message!, /مجموع درصد سهام صفر است/);
  await prisma.shareholder.deleteMany();
  assert.match((await calculateShareholderProfits(undefined, period('2026-11-01', '2026-11-30'))).message!, /هیچ صاحب سهامی/);
  assert.match((await calculateShareholderProfits(undefined, form({ periodStart: '', periodEnd: '' }))).message!, /فیلدهای الزامی/);
  assert.equal(await prisma.shareholderProfit.count(), 0);
});

test('a profit is paid out in parts, from a dollar account in dollars, never above what is left', async () => {
  await openAccount('usd', 100, 'USD');
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 100_000, date: new Date('2026-09-20') } });
  const pay = (amount: string, accountId = 'bank') =>
    withdrawShareholderProfit(undefined, form({ profitId: profit.id, amount, accountId, date: '2026-10-01T20:30:00.000Z' }));

  assert.equal((await pay('400000')).success, true);
  assert.equal((await pay('500000', 'usd')).success, true);
  assert.equal(await balanceOf('usd'), 95);
  const row = await prisma.transaction.findFirstOrThrow({ where: { accountId: 'usd', category: 'Shareholder Profit Withdrawal' } });
  assert.deepEqual([Number(row.amount), row.currency, Number(row.amountInToman), row.date.toISOString()], [5, 'USD', 500_000, '2026-10-01T20:30:00.000Z']);

  const one = await getShareholderProfitById(profit.id);
  assert.deepEqual([one!.withdrawn, one!.available], [900_000, 100_000]);
  assert.equal(one!.withdrawals.length, 2);

  assert.match((await pay('100001')).message!, /بیشتر از سود قابل برداشت/);
  assert.match((await pay('1000', 'nowhere')).message!, /حساب یافت نشد/);
  assert.match((await withdrawShareholderProfit(undefined, form({ profitId: 'nothing', amount: '1', accountId: 'bank' }))).message!, /سود یافت نشد/);
  assert.equal(await getShareholderProfitById('nothing'), undefined);
  assert.equal(await withdrawnOf(), 900_000);
  assert.equal(await driftOf('bank'), 0);
  assert.equal(await driftOf('usd'), 0);
});

test('each shareholder gets exactly their share; what the shares do not cover stays undistributed, on the profits page', async () => {
  await prisma.shareholderProfit.deleteMany();
  await prisma.shareholder.update({ where: { id: profit.shareholderId }, data: { percentage: 60 } });
  await prisma.shareholder.create({ data: { name: 'Reza', percentage: 20 } });
  await sale('2026-10-05T08:00:00Z', 10_000_000);

  const calculated = await calculateShareholderProfits(undefined, period('2026-10-01', '2026-10-31'));
  assert.equal(calculated.success, true, calculated.message);
  assert.match(calculated.message!, /تقسیم‌نشده: ۲٬۰۰۰٬۰۰۰ تومان/);
  const profits = await getShareholderProfits();
  assert.deepEqual(profits.map((p: any) => [p.shareholder.name, p.amount, p.periodNetProfit]).sort(), [
    ['Ali', 6_000_000, 10_000_000],
    ['Reza', 2_000_000, 10_000_000],
  ]);

  // A period calculated before the net profit was kept split all of it.
  await prisma.shareholderProfit.create({
    data: { shareholderId: profit.shareholderId, amount: 3_000_000, periodStart: new Date('2026-09-01T00:00:00Z'), periodEnd: new Date('2026-09-30T00:00:00Z') },
  });
  const periods = profitPeriods(await getShareholderProfits());
  assert.deepEqual(periods.map((p) => [p.netProfit, p.distributed, p.undistributed]), [
    [10_000_000, 8_000_000, 2_000_000],
    [3_000_000, 3_000_000, 0],
  ]);

  const html = renderToStaticMarkup(React.createElement(ShareholderProfitList, { profits: await getShareholderProfits(), accounts: [] }));
  assert.ok(html.includes('تقسیم‌نشده'));
  assert.ok(html.includes('۲٬۰۰۰٬۰۰۰ تومان'));
});

test('shares of exactly a third each pay out the whole profit to the toman', async () => {
  await prisma.shareholderProfit.deleteMany();
  await prisma.shareholder.update({ where: { id: profit.shareholderId }, data: { percentage: 33.34 } });
  await prisma.shareholder.create({ data: { name: 'Reza', percentage: 33.33 } });
  await prisma.shareholder.create({ data: { name: 'Mina', percentage: 33.33 } });
  await sale('2026-10-05T08:00:00Z', 10_000_000);
  assert.equal((await calculateShareholderProfits(undefined, period('2026-10-01', '2026-10-31'))).success, true);
  const amounts = (await prisma.shareholderProfit.findMany()).map((p: any) => p.amount.toString()).sort();
  assert.deepEqual(amounts, ['3333000', '3333000', '3334000']);
});
