import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteOrderSummary } from '@/components/settings/site-orders';

const NOW = new Date('2026-09-27T15:00:00');
const at = (daysAgo: number, hour = 10) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const order = (n: number, daysAgo: number, extra: Record<string, unknown> = {}) => ({
  id: `o${n}`,
  number: n,
  siteReference: `WEB-${n}`,
  status: 'COMPLETED',
  paymentStatus: 'PAID',
  totalAmount: 1_100_000,
  discount: 100_000,
  createdAt: at(daysAgo),
  customer: { name: 'سارا' },
  ...extra,
});

test('site orders: today and 7 days without cancelled ones, revenue net of discount, newest first', () => {
  const summary = siteOrderSummary(
    [
      order(1, 0),
      order(2, 0, { status: 'CANCELLED' }),
      order(3, 6),
      order(4, 7),
      { ...order(5, 0), siteReference: null }, // a shop sale
      order(6, 1, { customer: null }),
    ],
    NOW,
  );
  assert.equal(summary.today, 1);
  assert.equal(summary.week, 3, 'today, yesterday and 6 days ago; not 7 days ago, not the cancelled one');
  assert.equal(summary.revenue7d, 3_000_000);
  assert.equal(summary.total, 5, 'every order with a site reference');
  assert.deepEqual(summary.recent.map((o) => o.number), [1, 2, 6, 3, 4]);
  assert.equal(summary.recent.find((o) => o.number === 6)?.customer, 'مشتری سایت');
  assert.equal(summary.recent[0].final, 1_000_000);
});
