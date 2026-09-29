import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { atParam, nextPeriodStart, periodAt, previousPeriod, resolvePeriod, trailingMonths } from '@/components/reports/pnl-periods';
import { tenureMonths, upcomingAnniversaries } from '@/components/accounting/employee-tenure';
import { currentPeriod } from '@/components/accounting/payroll-periods';
import { siteOrderSummary } from '@/components/settings/site-orders';

// The design screens' own date helpers, checked in the zones they run in: the server (UTC on Vercel) and the
// browser (Tehran). A day is Tehran's day in both, or the pages show different days and fail to hydrate.

const zone = process.env.TZ;
after(() => {
  process.env.TZ = zone;
});
const ZONES = ['UTC', 'Asia/Tehran', 'America/New_York'];

test('the P&L periods are Jalali months, seasons and years of Tehran days, in any runtime zone', () => {
  // 00:40 on 1 Mehr 1405 in Tehran (21:10 UTC on 22 Sep).
  const now = new Date('2026-09-22T21:10:00.000Z');
  for (const tz of ZONES) {
    process.env.TZ = tz;
    const month = resolvePeriod({}, now);
    assert.equal(month.label, 'مهر ۱۴۰۵', tz);
    assert.equal(month.from.toISOString(), '2026-09-22T20:30:00.000Z', tz);
    assert.equal(month.to.toISOString(), '2026-10-22T20:29:59.999Z', tz);
    const before = previousPeriod(month);
    assert.deepEqual([before.label, before.from.toISOString()], ['شهریور ۱۴۰۵', '2026-08-22T20:30:00.000Z'], tz);
    assert.equal(nextPeriodStart(before).toISOString(), month.from.toISOString(), tz);
    assert.equal(atParam(month.from), '2026-09-23', tz);
    assert.equal(resolvePeriod({ period: 'month', at: atParam(before.from) }).label, 'شهریور ۱۴۰۵', tz);
    assert.deepEqual(trailingMonths(month.to, 3).map((m) => m.label), ['مرداد ۱۴۰۵', 'شهریور ۱۴۰۵', 'مهر ۱۴۰۵'], tz);
    assert.equal(periodAt('year', now).from.toISOString(), '2026-03-20T20:30:00.000Z', tz);
    assert.equal(periodAt('quarter', now).label, 'پاییز ۱۴۰۵', tz);
    const custom = resolvePeriod({ from: '2026-09-01', to: '2026-09-10' });
    assert.deepEqual([custom.from.toISOString(), custom.to.toISOString()], ['2026-08-31T20:30:00.000Z', '2026-09-10T20:29:59.999Z'], tz);
    assert.deepEqual(currentPeriod(now), { year: 1405, month: 7 }, tz);
  }
});

test('tenure and work anniversaries count Tehran days in any runtime zone', () => {
  // Hired on 1 Mehr 1403, stored at its Tehran midnight; today is 30 Shahrivar 1405, 22:00 in Tehran.
  const hired = new Date('2024-09-21T20:30:00.000Z');
  const today = new Date('2026-09-21T18:30:00.000Z');
  for (const tz of ZONES) {
    process.env.TZ = tz;
    assert.equal(tenureMonths(hired, today), 23, tz);
    const [next] = upcomingAnniversaries([{ id: 'e', name: 'سارا', hireDate: hired }], today);
    assert.deepEqual([next.years, next.days, next.date.toISOString()], [2, 2, '2026-09-22T20:30:00.000Z'], tz);
  }
});

test('the site page counts today and the last 7 days in Tehran, net of the discount', () => {
  // 00:15 on 5 Mehr in Tehran (20:45 UTC on 26 Sep).
  const now = new Date('2026-09-26T20:45:00.000Z');
  const order = (n: number, at: string) => ({
    id: `o${n}`, number: n, siteReference: `WEB-${n}`, status: 'COMPLETED', paymentStatus: 'PAID',
    totalAmount: 1_100_000, discount: 100_000, createdAt: new Date(at), customer: { name: 'سارا' },
  });
  for (const tz of ZONES) {
    process.env.TZ = tz;
    const summary = siteOrderSummary(
      [
        order(1, '2026-09-26T20:35:00.000Z'), // 00:05 today in Tehran
        order(2, '2026-09-26T20:25:00.000Z'), // 23:55 yesterday in Tehran
        order(3, '2026-09-20T20:35:00.000Z'), // 00:05 six days ago
        order(4, '2026-09-20T20:25:00.000Z'), // 23:55 seven days ago
      ],
      now,
    );
    assert.deepEqual([summary.today, summary.week, summary.revenue7d], [1, 3, 3_000_000], tz);
  }
});
