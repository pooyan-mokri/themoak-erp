// Sales and money over any period on the ERP API (src/lib/erp-api-reports.ts). Pooyan, 2026-11-18: asked for a sales
// report, Claude's connector said it could read only the last 100 sales. salesReport now adds up every sale in a
// range (or the whole history) on the server, by the ERP's own «گزارش فروش» rules, and orders and transactions take a
// date range and pages, with a total.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { GET } from '@/app/api/erp/route';
import { createApiKey } from '@/actions/api-keys';
import { getSalesByCustomer, getSalesByProduct, getSalesOverTime } from '@/actions/reports';

console.error = () => {};

const FULL = 'owner-full-key-for-sales-report-tests';

beforeEach(async () => {
  process.env.ERP_API_SECRET = FULL;
  process.env.ERP_SITE_API_SECRET = 'site-key-for-sales-report-tests';
  setTestRole('ADMIN');
  await resetDatabase();
  await prisma.user.create({ data: { id: 'test-user', name: 'مدیر', email: 'owner@x.test', password: 'x', role: 'ADMIN' } });
});
after(() => prisma.$disconnect());

const get = async (query: string, key = FULL) => {
  const res = await GET(new NextRequest(`http://localhost/api/erp?${query}`, { headers: { authorization: `Bearer ${key}` } }));
  return { status: res.status, body: await res.json() };
};

/** A Tehran moment: `day` at `time`, +03:30. */
const at = (day: string, time = '12:00') => new Date(`${day}T${time}:00+03:30`);

let world: Awaited<ReturnType<typeof sales>>;

/**
 * 150 shop sales of one frame across three Jalali months (more than the old 100-order cap), plus one with a discount
 * and a return, one from the website, a walk-in sale, and a cancelled order.
 */
async function sales() {
  const account = await prisma.account.create({ data: { id: 'cash', name: 'صندوق', type: 'CASH', currency: 'TOMAN', balance: 0 } });
  const frame = await prisma.product.create({ data: { name: 'PANJ - Blue', sku: 'PANJ/BLUE', costPrice: 0, sellPrice: 1_000_000 } });
  const strap = await prisma.product.create({ data: { name: 'بند عینک', sku: 'STRAP', costPrice: 0, sellPrice: 100_000 } });
  const sara = await prisma.customer.create({ data: { name: 'سارا' } });
  const ali = await prisma.customer.create({ data: { name: 'علی' } });
  const sell = (day: string, lines: Array<[string, number, number]>, extra: Record<string, unknown> = {}) => {
    const total = lines.reduce((s, [, q, p]) => s + q * p, 0);
    return prisma.order.create({
      data: {
        totalAmount: total,
        paidAmount: total - Number(extra.discount ?? 0),
        createdAt: at(day),
        ...extra,
        items: { create: lines.map(([productId, quantity, price]) => ({ productId, quantity, price })) },
      },
      include: { items: true },
    });
  };
  // 150 orders, 50 in each of Shahrivar (to 2026-09-22), Mehr (2026-09-23 to 10-22) and Aban 1405 (2026-10-23 to 11-21).
  const mehr = Array.from({ length: 50 }, (_, i) => `2026-10-${String(1 + (i % 20)).padStart(2, '0')}`);
  const aban = Array.from({ length: 50 }, (_, i) => `2026-11-${String(1 + (i % 10)).padStart(2, '0')}`);
  const shahrivar = Array.from({ length: 50 }, (_, i) => `2026-09-${String(1 + (i % 20)).padStart(2, '0')}`);
  for (const day of [...shahrivar, ...mehr, ...aban]) await sell(day, [[frame.id, 1, 1_000_000]], { customerId: sara.id });
  // 2 frames and a strap, 210,000 off, one frame returned: 1,000,000 of the 2,100,000 comes back.
  const discounted = await sell('2026-11-12', [[frame.id, 2, 1_000_000], [strap.id, 1, 100_000]], { customerId: ali.id, discount: 210_000, paidAmount: 1_000_000 });
  await prisma.orderReturn.create({ data: { orderId: discounted.id, orderItemId: discounted.items[0].id, quantity: 1, refundAmount: 900_000, accountId: account.id } });
  await sell('2026-11-13', [[strap.id, 3, 100_000]], { siteReference: 'SITE-1', customerId: sara.id });
  await sell('2026-11-14', [[strap.id, 1, 100_000]]);
  await sell('2026-11-14', [[frame.id, 5, 1_000_000]], { status: 'CANCELLED', customerId: ali.id });
  return { frame, strap, sara, ali };
}

test('salesReport adds up every sale of the whole history, past the old 100-order cap, as the ERP\'s own sales report', async () => {
  world = await sales();
  const { status, body } = await get('action=salesReport');
  assert.equal(status, 200, JSON.stringify(body));
  // 150 + discounted + site + walk-in; the cancelled one apart.
  const gross = 150 * 1_000_000 + 2_100_000 + 300_000 + 100_000;
  assert.deepEqual(body.totals, {
    orders: 153,
    gross,
    discount: 210_000,
    revenue: gross - 210_000,
    paid: 150 * 1_000_000 + 1_000_000 + 300_000 + 100_000,
    outstanding: 2_100_000 - 210_000 - 1_000_000,
    units: 150 + (2 - 1 + 1) + 3 + 1,
    cancelledOrders: 1,
    averageOrder: Math.round((gross - 210_000) / 153),
  });
  assert.deepEqual([body.from, body.to, body.currency, body.groupBy], [null, null, 'TOMAN', 'month']);

  // By Jalali month: Shahrivar, Mehr and Aban 1405.
  assert.deepEqual(body.byPeriod.map((p: any) => [p.period, p.label, p.orders]), [
    ['1405-06', 'شهریور 1405', 50],
    ['1405-07', 'مهر 1405', 50],
    ['1405-08', 'آبان 1405', 53],
  ]);
  assert.equal(body.byPeriod.reduce((s: number, p: any) => s + p.revenue, 0), body.totals.revenue);

  // Website and shop.
  assert.deepEqual(body.bySource.site, { orders: 1, gross: 300_000, discount: 0, revenue: 300_000, paid: 300_000, outstanding: 0 });
  assert.equal(body.bySource.erp.orders, 152);

  // Products net of the return and of their share of the discount: after the return the order keeps a frame and a
  // strap, 1,100,000, and its 210,000 off is shared by value: 190,909 on the frame, 19,091 on the strap.
  assert.deepEqual(body.byProduct.map((p: any) => [p.sku, p.units, p.revenue, p.orders]), [
    ['PANJ/BLUE', 151, 150 * 1_000_000 + 809_091, 151],
    ['STRAP', 5, 80_909 + 300_000 + 100_000, 3],
  ]);
  assert.deepEqual(body.byCustomer.map((c: any) => [c.name, c.orders]), [['سارا', 151], ['علی', 1], ['مشتری حضوری', 1]]);

  // The same figures as the «گزارش فروش» page over the same whole period.
  const start = new Date('2000-01-01');
  const end = new Date('2100-01-01');
  const [byProduct, byCustomer, overTime] = await Promise.all([getSalesByProduct(start, end), getSalesByCustomer(start, end), getSalesOverTime(start, end, 'day')]);
  assert.deepEqual(byProduct.map((p: any) => [p.name, p.quantity, Math.round(p.revenue)]), body.byProduct.map((p: any) => [p.name, p.units, p.revenue]));
  assert.deepEqual(byCustomer.map((c: any) => [c.name, c.orderCount, Math.round(c.revenue)]), body.byCustomer.map((c: any) => [c.name, c.orders, c.revenue]));
  assert.equal(Math.round(Object.values(overTime as any).reduce((s: number, d: any) => s + d.revenue, 0) as number), body.totals.revenue);
});

test('salesReport over a range of Tehran days, by day, top N; a Jalali or backwards range is refused', async () => {
  world = await sales();
  const { body } = await get('action=salesReport&from=2026-11-12&to=2026-11-14&groupBy=day&top=1');
  assert.deepEqual([body.from, body.to, body.totals.orders, body.totals.cancelledOrders], ['2026-11-12', '2026-11-14', 3, 1]);
  assert.deepEqual(body.byPeriod.map((p: any) => [p.period, p.orders]), [['2026-11-12', 1], ['2026-11-13', 1], ['2026-11-14', 1]]);
  assert.deepEqual([body.productCount, body.byProduct.length, body.customerCount, body.byCustomer.length], [2, 1, 3, 1]);

  // A sale at 00:30 Tehran time on the 15th is the 15th's, though it is still the 14th in UTC.
  await prisma.order.create({ data: { totalAmount: 7, paidAmount: 7, createdAt: at('2026-11-15', '00:30') } });
  assert.equal((await get('action=salesReport&from=2026-11-15&to=2026-11-15')).body.totals.revenue, 7);
  assert.equal((await get('action=salesReport&from=2026-11-14&to=2026-11-14')).body.totals.orders, 1);

  for (const [query, pattern] of [
    ['from=1405-08-01', /شمسی/],
    ['to=2026/11/01', /YYYY-MM-DD/],
    ['from=2026-11-10&to=2026-11-01', /بعد از/],
    ['groupBy=week', /groupBy/],
    ['top=0', /top/],
  ] as Array<[string, RegExp]>) {
    const refused = await get(`action=salesReport&${query}`);
    assert.equal(refused.status, 422, query);
    assert.match(refused.body.error, pattern);
  }
});

test('orders and transactions reach the whole history a page at a time, with a total, by date range', async () => {
  world = await sales();
  // Every order, 200 a page at most: 154 in all, the cancelled one included.
  const first = await get('action=orders&limit=100');
  assert.deepEqual([first.body.total, first.body.offset, first.body.limit, first.body.orders.length, first.body.nextOffset], [154, 0, 100, 100, 100]);
  const second = await get('action=orders&limit=100&offset=100');
  assert.deepEqual([second.body.orders.length, second.body.nextOffset], [54, null]);
  const ids = new Set([...first.body.orders, ...second.body.orders].map((o: any) => o.id));
  assert.equal(ids.size, 154, 'no order twice, none left out');
  // A page is at most 200, whatever is asked.
  assert.equal((await get('action=orders&limit=1000')).body.limit, 200);

  const range = await get('action=orders&from=2026-11-12&to=2026-11-14');
  // Newest first; the two of the 14th at the same moment, the later-made first.
  assert.deepEqual(range.body.orders.map((o: any) => [o.status, o.source]), [['CANCELLED', 'erp'], ['COMPLETED', 'erp'], ['COMPLETED', 'site'], ['COMPLETED', 'erp']]);
  assert.equal(range.body.total, 4);
  assert.equal((await get('action=orders&status=cancelled')).body.total, 1);
  assert.deepEqual((await get('action=orders&from=2026-11-12&to=2026-11-12')).body.orders[0].items.map((i: any) => i.sku), ['PANJ/BLUE', 'STRAP']);
  assert.equal((await get('action=orders&offset=-1')).status, 422);

  // 600 rows of money: more than a page of 500, with totals over all of them.
  const account = await prisma.account.findFirstOrThrow();
  await prisma.transaction.createMany({
    data: Array.from({ length: 600 }, (_, i) => ({ type: i % 3 ? 'INCOME' : 'EXPENSE', amount: 1000, amountInToman: 1000, accountId: account.id, category: i % 2 ? 'فروش' : 'اجاره', date: at(i < 300 ? '2026-10-10' : '2026-11-10') })) as any,
  });
  const page = await get('action=transactions&limit=500');
  assert.deepEqual([page.body.total, page.body.transactions.length, page.body.nextOffset], [600, 500, 500]);
  assert.deepEqual(page.body.totalsByType, { INCOME: { count: 400, amountInToman: 400_000 }, EXPENSE: { count: 200, amountInToman: 200_000 } });
  const november = await get('action=transactions&from=2026-11-01&to=2026-11-30&type=INCOME&account=صندوق&category=فروش&limit=500');
  assert.equal(november.body.total, november.body.transactions.length);
  assert.ok(november.body.transactions.every((t: any) => t.type === 'INCOME' && t.category === 'فروش' && t.date.startsWith('2026-11')));
  assert.equal((await get('action=transactions&from=1405-01-01')).status, 422);
});

test('a personal key reads salesReport with sales.view; one without it gets 403', async () => {
  world = await sales();
  const keyFor = async (name: string, role: string) => {
    const user = await prisma.user.create({ data: { name, email: `${role.toLowerCase()}@x.test`, password: 'x', role: role as any } });
    setTestRole('ADMIN');
    return ((await createApiKey(user.id, 'Claude')) as any).key as string;
  };
  const seller = await keyFor('سارا', 'SALES');
  const warehouse = await keyFor('رضا', 'WAREHOUSE');
  assert.equal((await get('action=salesReport', seller)).body.totals.orders, 153);
  assert.equal((await get('action=salesReport', warehouse)).status, 403);
  assert.ok(((await get('action=whoami', seller)).body.actions as string[]).includes('salesReport'));
});
