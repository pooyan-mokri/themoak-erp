import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getBreadcrumbs } from '@/lib/breadcrumbs';
import { ORDER_STATUS_LABELS, orderStatusLabel } from '@/lib/order-status';
import { orderExportRow } from '@/lib/order-list';

// Found by the page crawl: a POS sale's order id (pos-<requestId>, src/actions/sales.ts) was shown raw in the
// breadcrumb, a crumb after a record id linked to a path without it, and an invoiced order's status was
// shown as INVOICED (and exported as «در انتظار»).

test('the breadcrumb skips record ids, a POS order id too, and a crumb after one links through it', () => {
  for (const id of ['cmul2uzpp000g3hr2khryv9ys', 'pos-demo-return-exchange-0001']) {
    const crumbs = getBreadcrumbs(`/dashboard/sales/orders/${id}/print`);
    assert.deepEqual(
      crumbs.map((c) => [c.label, c.href]),
      [
        ['فروش', '/dashboard/sales'],
        ['سفارشات', '/dashboard/sales/orders'],
        ['چاپ', `/dashboard/sales/orders/${id}/print`],
      ],
      id,
    );
  }
  assert.deepEqual(getBreadcrumbs('/dashboard/sales/history/pos-a1b2c3d4e5').map((c) => c.label), ['فروش', 'تاریخچه فروش']);
});

test('every order status is named in Persian, on the order page, the list and its export', () => {
  assert.deepEqual(Object.keys(ORDER_STATUS_LABELS).sort(), ['CANCELLED', 'COMPLETED', 'INVOICED', 'PENDING']);
  for (const label of Object.values(ORDER_STATUS_LABELS)) assert.match(label, /^[؀-ۿ‌ ]+$/);
  assert.equal(orderStatusLabel('INVOICED'), 'فاکتور شده');
  const row = orderExportRow({
    number: 1, createdAt: new Date('2026-09-20T08:00:00Z'), status: 'INVOICED', paymentStatus: 'PAID',
    totalAmount: 1_000_000, discount: 0, paidAmount: 1_000_000, items: [{ quantity: 1 }],
  });
  assert.equal(row['وضعیت سفارش'], 'فاکتور شده');
});

test('every dashboard page\'s breadcrumb is Persian: no route segment falls back to its English name', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = join(process.cwd(), 'src/app/dashboard');
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name === 'page.tsx') routes.push('/dashboard' + dir.slice(root.length).replace(/\[[^\]]+\]/g, 'cmul2uzpp000g3hr2khryv9ys'));
    }
  };
  walk(root);
  const english = routes.flatMap((route) => getBreadcrumbs(route).filter((c) => /[A-Za-z]/.test(c.label)).map((c) => `${route}: ${c.label}`));
  assert.deepEqual(english, []);
});
