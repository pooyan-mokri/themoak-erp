// The server runs in UTC (Vercel); days must still be Tehran's.
process.env.TZ = 'UTC';

import { test, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getTransactions } from '@/actions/accounting';
import { getDashboardSales } from '@/actions/dashboard';
import { getProfitLossReport } from '@/actions/reports';
import { calculateShareholderProfits, getShareholderProfits } from '@/actions/shareholder-profit';
import FinancialReportsPage from '../../src/app/dashboard/reports/financial/page';
import { ProfitLossReport } from '@/components/reports/profit-loss-report';
import { addDays, tehranDay, tehranDayEnd, tehranDayStart } from '@/lib/tehran-day';

(globalThis as any).React = React;
// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  mock.timers.reset();
  await resetDatabase();
});
after(async () => {
  mock.timers.reset();
  await prisma.$disconnect();
});

/** Freezes the clock at this moment (the database is left alone). */
const at = (iso: string) => mock.timers.enable({ apis: ['Date'], now: new Date(iso) });

const sale = (date: string, amount = 1_000_000, description = date) =>
  prisma.transaction.create({ data: { type: 'INCOME', amount, amountInToman: amount, category: 'Sales', date: new Date(date), description } });

/** The props of the first element of `type` in a rendered server component tree. */
function propsOf(node: any, type: unknown): any {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = propsOf(child, type);
      if (found) return found;
    }
    return undefined;
  }
  if (node.type === type) return node.props;
  return propsOf(node.props?.children, type);
}

test('the Tehran day helpers', () => {
  assert.equal(tehranDay(new Date('2026-09-22T20:29:59.999Z')), '2026-09-22');
  assert.equal(tehranDay(new Date('2026-09-22T20:30:00.000Z')), '2026-09-23');
  assert.equal(tehranDayStart('2026-09-23').toISOString(), '2026-09-22T20:30:00.000Z');
  assert.equal(tehranDayEnd('2026-09-23').toISOString(), '2026-09-23T20:29:59.999Z');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('a journal period of days holds the rows picked for its first day and ends with its last Tehran day', async () => {
  // 1 Mehr is 23 September; the date picker sends its Tehran midnight.
  await sale('2026-09-22T20:29:59.999Z', 1, 'last moment of 31 Shahrivar');
  await sale('2026-09-22T20:30:00.000Z', 1, 'picked for 1 Mehr');
  await sale('2026-09-23T02:00:00.000Z', 1, '1 Mehr, 05:30');
  await sale('2026-09-23T20:29:59.999Z', 1, 'last moment of 1 Mehr');
  await sale('2026-09-23T20:30:00.000Z', 1, 'picked for 2 Mehr');

  const firstOfMehr = await getTransactions({ from: '2026-09-23', to: '2026-09-23' });
  assert.deepEqual(
    firstOfMehr.map((t: any) => t.description).sort(),
    ['1 Mehr, 05:30', 'last moment of 1 Mehr', 'picked for 1 Mehr'],
  );
});

test('the dashboard\'s today and yesterday are Tehran days, on a server that runs in UTC', async () => {
  // 00:30 on 28 September in Tehran, still 27 September in UTC.
  const order = (createdAt: string, totalAmount: number, status = 'COMPLETED') =>
    prisma.order.create({ data: { totalAmount, status, createdAt: new Date(createdAt) } });
  await order('2026-09-27T20:45:00Z', 7_000_000); // 28 Sep 00:15 Tehran: today
  await order('2026-09-27T20:50:00Z', 9_000_000, 'CANCELLED');
  await order('2026-09-27T19:00:00Z', 5_000_000); // 27 Sep 22:30 Tehran: yesterday
  await order('2026-09-26T20:29:00Z', 3_000_000); // 26 Sep 23:59 Tehran: before yesterday
  at('2026-09-27T21:00:00Z');

  const sales = await getDashboardSales();
  assert.deepEqual(sales.today, { total: 7_000_000, count: 1 });
  assert.deepEqual(sales.yesterday, { total: 5_000_000 });
  assert.deepEqual(sales.dailySales, [
    { date: '2026-09-26', total: 3_000_000, count: 1 },
    { date: '2026-09-27', total: 5_000_000, count: 1 },
    { date: '2026-09-28', total: 7_000_000, count: 1 },
  ]);
});

test('the profit and loss page\'s month runs from its first Tehran midnight through the whole of its last day', async () => {
  await sale('2026-08-31T20:29:00Z', 1_000); // 31 Aug 23:59 Tehran: August
  await sale('2026-08-31T20:45:00Z', 20_000); // 1 Sep 00:15 Tehran
  await sale('2026-09-30T15:00:00Z', 300_000); // 30 Sep 18:30 Tehran: the last day
  await sale('2026-09-30T20:45:00Z', 4_000_000); // 1 Oct 00:15 Tehran
  at('2026-09-30T19:00:00Z');

  const page = await FinancialReportsPage({ searchParams: {} });
  const report = propsOf(page, ProfitLossReport).data;
  assert.equal(report.summary.income, 320_000);

  const asked = propsOf(await FinancialReportsPage({ searchParams: { from: '2026-09-01', to: '2026-10-01' } }), ProfitLossReport).data;
  assert.equal(asked.summary.income, 4_320_000);
  assert.deepEqual(asked.monthlyTrend.map((m: any) => [m.month, m.income]), [['2026-09', 320_000], ['2026-10', 4_000_000]]);
});

test('the P&L month of a row is its Tehran month', async () => {
  await sale('2026-09-30T20:45:00Z', 4_000_000); // 1 Oct 00:15 Tehran
  const report = await getProfitLossReport(new Date('2026-09-01T00:00:00Z'), new Date('2026-12-31T00:00:00Z'));
  assert.deepEqual(report.monthlyTrend.map((m: any) => m.month), ['2026-10']);
});

test('a shareholders\' profit period holds the whole of its last day, and the next period starts the day after', async () => {
  await prisma.shareholder.create({ data: { name: 'Ali', percentage: 100 } });
  // 1 to 30 Mehr as the form sends them: the Tehran midnights the date picker gives.
  const mehr = { periodStart: '2026-09-22T20:30:00.000Z', periodEnd: '2026-10-21T20:30:00.000Z' };
  await sale('2026-09-22T20:30:00.000Z', 1_000_000); // 1 Mehr, picked
  await sale('2026-10-22T08:30:00.000Z', 500_000); // 30 Mehr, midday
  await sale('2026-10-22T20:30:00.000Z', 9_000_000); // 1 Aban, picked

  const calculated = await calculateShareholderProfits(undefined, form(mehr));
  assert.equal(calculated.success, true, calculated.message);
  const [profit] = await getShareholderProfits();
  assert.equal(profit.amount, 1_500_000);
  assert.equal(profit.periodStart.toISOString(), '2026-09-22T20:30:00.000Z');
  assert.equal(profit.periodEnd.toISOString(), '2026-10-22T20:29:59.999Z');

  const overlapping = await calculateShareholderProfits(undefined, form({ periodStart: mehr.periodEnd, periodEnd: '2026-11-20T20:30:00.000Z' }));
  assert.match(overlapping.message!, /قبلاً سود محاسبه شده/, 'the last day of Mehr is in Mehr');
  const aban = await calculateShareholderProfits(undefined, form({ periodStart: '2026-10-22T20:30:00.000Z', periodEnd: '2026-11-20T20:30:00.000Z' }));
  assert.equal(aban.success, true, aban.message);
  assert.equal((await getShareholderProfits()).find((p: any) => p.id !== profit.id)!.amount, 9_000_000);

  const backwards = await calculateShareholderProfits(undefined, form({ periodStart: '2027-01-10', periodEnd: '2027-01-01' }));
  assert.match(backwards.message!, /بازه دوره معتبر نیست/);
});
