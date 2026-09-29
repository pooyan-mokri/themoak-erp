import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { AccessDenied } from '@/lib/access';
import { getSalesTimeline } from '@/actions/sales-timeline';
import { getSalesOverTime } from '@/actions/reports';
import { DAY, reportWindow, startOfJalaliYear, jalaliDate, summarizeSales } from '@/components/reports/report-window';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const ROLES = ['ADMIN', 'AUDITOR', 'ACCOUNTANT', 'SALES', 'WAREHOUSE', 'PROJECT_MANAGER', 'USER'];
const SALES_VIEW = ['ADMIN', 'AUDITOR', 'ACCOUNTANT', 'SALES'];

/** A shop sale, a site sale, an old WooCommerce sale and a cancelled one, all within the last day. */
async function seedOrders() {
  const product = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ-1', costPrice: 1_234_567, sellPrice: 2_000_000 } });
  const at = new Date(Date.now() - 3_600_000);
  const order = (data: Record<string, unknown>) =>
    prisma.order.create({
      data: { createdAt: at, items: { create: [{ productId: product.id, quantity: 1, price: 2_000_000 }] }, ...data } as any,
    });
  await order({ totalAmount: 2_000_000 });
  await order({ totalAmount: 3_000_000, siteReference: 'site-1' });
  await order({ totalAmount: 5_000_000, wooId: 77 });
  await order({ totalAmount: 7_000_000, status: 'CANCELLED' });
}

test('the timeline counts what the customer pays, after the discount, as getSalesOverTime does', async () => {
  const product = await prisma.product.create({ data: { name: 'SHESH', sku: 'SHESH-1', costPrice: 1, sellPrice: 2_000_000 } });
  const at = new Date(Date.now() - 3_600_000);
  const order = (data: Record<string, unknown>) =>
    prisma.order.create({ data: { createdAt: at, items: { create: [{ productId: product.id, quantity: 1, price: 2_000_000 }] }, ...data } as any });
  await order({ totalAmount: 2_000_000, discount: 300_000 });
  // An old WooCommerce order stored its total after the discount (src/lib/order-balance.ts).
  await order({ totalAmount: 1_700_000, discount: 300_000, wooId: 88 });
  const rows = await getSalesTimeline(...lastDays());
  assert.deepEqual(rows.map((row) => row.amount).sort(), [1_700_000, 1_700_000]);
  const period = reportWindow('4w');
  const daily = await getSalesOverTime(new Date(period.start), new Date(period.end), 'day');
  assert.equal(summarizeSales(period, rows, []).totals.revenue, daily.reduce((sum, day) => sum + day.revenue, 0));
});

const lastDays = () => [new Date(Date.now() - 2 * DAY), new Date(Date.now() + DAY)] as const;

test('the sales timeline needs sales.view, like the other sales reports', async () => {
  await seedOrders();
  for (const role of ROLES) {
    setTestRole(role);
    if (SALES_VIEW.includes(role)) {
      await getSalesTimeline(...lastDays());
    } else {
      await assert.rejects(getSalesTimeline(...lastDays()), (error: unknown) => {
        assert.ok(error instanceof AccessDenied, role);
        return true;
      });
    }
  }
});

test('the timeline carries when, how much and which source — no cancelled order and no cost', async () => {
  await seedOrders();
  setTestRole('SALES');
  const rows = await getSalesTimeline(...lastDays());
  assert.deepEqual(
    rows.map((row) => [row.amount, row.channel]).sort((a, b) => Number(a[0]) - Number(b[0])),
    [
      [2_000_000, 'shop'],
      [3_000_000, 'site'],
      [5_000_000, 'woo'],
    ],
  );
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ['amount', 'at', 'channel']);
  assert.equal(JSON.stringify(rows).includes('1234567'), false);
});

test('the overview totals match getSalesOverTime for the same period', async () => {
  await seedOrders();
  const period = reportWindow('4w');
  const [current, daily] = await Promise.all([
    getSalesTimeline(new Date(period.start), new Date(period.end)),
    getSalesOverTime(new Date(period.start), new Date(period.end), 'day'),
  ]);
  const summary = summarizeSales(period, current, []);
  assert.equal(summary.totals.revenue, daily.reduce((sum, day) => sum + day.revenue, 0));
  assert.equal(summary.totals.orders, daily.reduce((sum, day) => sum + day.orders, 0));
  assert.equal(summary.trend.length, 28);
  assert.equal(summary.heat.orders.flat().reduce((a, b) => a + b, 0), 3);
});

test('each range is compared with a period of the same shape before it, in Tehran days', () => {
  const now = Date.parse('2026-09-27T15:00:00Z'); // 18:30 in Tehran, 1405/07/05
  const fourWeeks = reportWindow('4w', now);
  assert.equal(new Date(fourWeeks.start).toISOString(), '2026-08-30T20:30:00.000Z'); // midnight in Tehran
  assert.equal(fourWeeks.end - fourWeeks.start, fourWeeks.prevEnd - fourWeeks.prevStart);
  assert.equal(fourWeeks.start - fourWeeks.prevStart, 28 * DAY);

  const year = reportWindow('ytd', now);
  assert.deepEqual(jalaliDate(year.start), { year: 1405, month: 1, day: 1 });
  assert.deepEqual(jalaliDate(year.prevStart), { year: 1404, month: 1, day: 1 });
  // 1403 had 366 days: its first day is still found from its last one.
  assert.deepEqual(jalaliDate(startOfJalaliYear(Date.parse('2025-03-20T10:00:00Z'))), { year: 1403, month: 1, day: 1 });

  const sale = { at: new Date(now - 3_600_000), amount: 100, channel: 'site' as const };
  const earlier = { at: new Date(fourWeeks.prevStart + 1000), amount: 40, channel: 'shop' as const };
  const summary = summarizeSales(fourWeeks, [sale], [earlier]);
  assert.deepEqual(summary.totals, { revenue: 100, orders: 1, prevRevenue: 40, prevOrders: 1 });
  // 17:30 on a Sunday in Tehran: the second row (Saturday first), hour 17.
  assert.equal(summary.heat.orders[1][17], 1);
});
