/**
 * Reading sales and money over any period on the ERP API (/api/erp), not only the latest rows: `orders` and
 * `transactions` take a date range and pages, and `salesReport` adds up every sale in a range on the server, by the
 * rules of the ERP's own «گزارش فروش» page (src/actions/reports.ts), so Claude's connector gets the same figures
 * without reading thousands of orders.
 *
 * A day is Tehran's (src/lib/tehran-day.ts): `from` is included from its first moment, `to` up to its last.
 * Days are Gregorian (YYYY-MM-DD); a Jalali «1405-08-01» would be read as the year 1405 and is refused.
 */
import { orderTotals } from '@/lib/order-balance';
import { SALE_LINE_INCLUDE, netLineSale } from '@/lib/product-sales';
import { isDay, jalaliYearMonth, tehranDay, tehranDayEnd, tehranDayStart } from '@/lib/tehran-day';

type Reply = { status: number; body: any };
const refuse = (error: string): Reply => ({ status: 422, body: { error } });
class Refusal extends Error {}

const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const round = (n: number) => Math.round(n);

/** The period asked for, as createdAt/date bounds; none given is everything. */
export function readPeriod(params: URLSearchParams): { from: string | null; to: string | null; where: { gte?: Date; lte?: Date } | undefined } {
  const day = (name: 'from' | 'to') => {
    const value = (params.get(name) ?? '').trim();
    if (!value) return null;
    if (/^1[34]\d\d(\D|$)/.test(value)) throw new Refusal(`${name}="${value}" شمسی به نظر می‌رسد؛ تاریخ میلادی بفرستید، مثلاً 2026-03-21.`);
    if (!isDay(value) || Number.isNaN(tehranDayStart(value).getTime())) throw new Refusal(`${name} باید تاریخ میلادی به شکل YYYY-MM-DD باشد.`);
    return value;
  };
  const from = day('from');
  const to = day('to');
  if (from && to && from > to) throw new Refusal('from نمی‌تواند بعد از to باشد.');
  if (!from && !to) return { from, to, where: undefined };
  return { from, to, where: { ...(from && { gte: tehranDayStart(from) }), ...(to && { lte: tehranDayEnd(to) }) } };
}

/**
 * One page: `limit` rows from `offset`. A limit that is not a whole number from 1 falls back to the default and one
 * above `max` is cut to it, as the lists always did; an offset that is not a whole number from 0 is refused.
 */
function readPage(params: URLSearchParams, fallback: number, max: number) {
  const asked = Number(params.get('limit') ?? fallback);
  const limit = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, max) : fallback;
  const raw = params.get('offset');
  const offset = raw === null || raw === '' ? 0 : Number(raw);
  if (!Number.isInteger(offset) || offset < 0) throw new Refusal('offset باید عدد صحیح ۰ یا بیشتر باشد.');
  return { limit, offset };
}

/** What every page carries: how many rows the query has, and where the next page starts (null after the last). */
const paging = (total: number, offset: number, limit: number, count: number) => ({
  total,
  offset,
  limit,
  nextOffset: offset + count < total ? offset + count : null,
});

function answer(run: () => Promise<any>): Promise<Reply> {
  return run().then(
    (body) => ({ status: 200, body }),
    (error) => {
      if (error instanceof Refusal) return refuse(error.message);
      throw error;
    },
  );
}

const ORDER_STATUSES = ['COMPLETED', 'IN_PROGRESS', 'RETURNED', 'EXCHANGED', 'CANCELLED'];

/** Sales orders, newest first, a page at a time; `from`/`to` by the day the order was made, `status` to narrow. */
export function listOrders(client: any, params: URLSearchParams): Promise<Reply> {
  return answer(async () => {
    const period = readPeriod(params);
    const { limit, offset } = readPage(params, 30, 200);
    const status = (params.get('status') ?? '').trim().toUpperCase();
    if (status && !/^[A-Z_]{2,20}$/.test(status)) throw new Refusal(`status نامعتبر است؛ مثلاً ${ORDER_STATUSES.join('، ')}.`);
    const where = { ...(period.where && { createdAt: period.where }), ...(status && { status }) };
    const [total, orders] = await Promise.all([
      client.order.count({ where }),
      client.order.findMany({
        where,
        include: {
          customer: { select: { name: true } },
          items: { include: { product: { select: { name: true, sku: true } } } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
      }),
    ]);
    return {
      from: period.from,
      to: period.to,
      ...paging(total, offset, limit, orders.length),
      orders: orders.map((o: any) => ({
        id: o.id,
        number: o.number,
        customer: o.customer?.name ?? null,
        status: o.status,
        paymentStatus: o.paymentStatus,
        source: o.siteReference || o.wooId != null ? 'site' : 'erp',
        // Gross, before the discount: what the customer owes is totalAmount - discount.
        totalAmount: Number(o.totalAmount),
        discount: Number(o.discount),
        paidAmount: Number(o.paidAmount),
        createdAt: o.createdAt,
        items: o.items.map((i: any) => ({ sku: i.product?.sku, product: i.product?.name, quantity: i.quantity, price: Number(i.price) })),
      })),
    };
  });
}

const TRANSACTION_TYPES = ['INCOME', 'EXPENSE', 'TRANSFER', 'ADJUSTMENT'];

/** Money rows, newest first, a page at a time; `from`/`to` by the row's date, `type`, `account` (name or id) and `category` to narrow. */
export function listTransactions(client: any, params: URLSearchParams): Promise<Reply> {
  return answer(async () => {
    const period = readPeriod(params);
    const { limit, offset } = readPage(params, 50, 500);
    const type = (params.get('type') ?? '').trim();
    if (type && !TRANSACTION_TYPES.includes(type)) throw new Refusal('type باید INCOME، EXPENSE، TRANSFER یا ADJUSTMENT باشد.');
    const account = (params.get('account') ?? '').trim();
    const category = (params.get('category') ?? '').trim();
    const where = {
      ...(period.where && { date: period.where }),
      ...(type && { type }),
      ...(account && { account: { OR: [{ id: account }, { name: { contains: account, mode: 'insensitive' } }] } }),
      ...(category && { category: { contains: category, mode: 'insensitive' } }),
    };
    const [total, sums, rows] = await Promise.all([
      client.transaction.count({ where }),
      client.transaction.groupBy({ by: ['type'], where, _sum: { amountInToman: true }, _count: { _all: true } }),
      client.transaction.findMany({
        where,
        include: { account: { select: { name: true } } },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
      }),
    ]);
    return {
      from: period.from,
      to: period.to,
      ...paging(total, offset, limit, rows.length),
      // Over every row the query has, not only this page: rows and Toman per type.
      totalsByType: Object.fromEntries(
        sums.map((s: any) => [s.type, { count: s._count._all, amountInToman: round(Number(s._sum.amountInToman ?? 0)) }]),
      ),
      transactions: rows.map((t: any) => ({
        id: t.id,
        date: t.date,
        type: t.type,
        amount: Number(t.amount),
        currency: t.currency,
        amountInToman: Number(t.amountInToman),
        description: t.description,
        category: t.category,
        account: t.account?.name ?? null,
        payee: t.payee ?? null,
        tags: t.tags ?? [],
      })),
    };
  });
}

type Bucket = { orders: number; gross: number; discount: number; revenue: number; paid: number; outstanding: number };
const bucket = (): Bucket => ({ orders: 0, gross: 0, discount: 0, revenue: 0, paid: 0, outstanding: 0 });
const rounded = (b: Bucket) => ({
  orders: b.orders,
  gross: round(b.gross),
  discount: round(b.discount),
  revenue: round(b.revenue),
  paid: round(b.paid),
  outstanding: round(b.outstanding),
});

/**
 * Every sale in a period, added up: the «گزارش فروش» page's rules. Orders by the day they were made, cancelled ones
 * left out (counted apart). An order's revenue is what the customer pays, gross less its discount (orderTotals in
 * src/lib/order-balance.ts); a product's is net of returns and exchanges and of its share of the order's discount
 * (netLineSale in src/lib/product-sales.ts), as on the product pages. In Toman. No range is the whole history.
 * `groupBy` month (Jalali, default) or day (Tehran); `top` caps the product and customer lists (all by default).
 */
export function salesReport(client: any, params: URLSearchParams): Promise<Reply> {
  return answer(async () => {
    const period = readPeriod(params);
    const groupBy = (params.get('groupBy') ?? 'month').trim();
    if (!['month', 'day'].includes(groupBy)) throw new Refusal('groupBy باید month یا day باشد.');
    const topRaw = params.get('top');
    const top = topRaw === null || topRaw === '' ? null : Number(topRaw);
    if (top !== null && (!Number.isInteger(top) || top < 1)) throw new Refusal('top باید عدد صحیح ۱ یا بیشتر باشد.');

    const created = period.where && { createdAt: period.where };
    const [orders, cancelled] = await Promise.all([
      client.order.findMany({
        where: { ...created, status: { not: 'CANCELLED' } },
        select: {
          createdAt: true,
          totalAmount: true,
          discount: true,
          paidAmount: true,
          wooId: true,
          siteReference: true,
          customerId: true,
          customer: { select: { name: true } },
          items: { include: { product: { select: { name: true, sku: true } }, ...SALE_LINE_INCLUDE } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      client.order.count({ where: { ...created, status: 'CANCELLED' } }),
    ]);

    const totals = bucket();
    let units = 0;
    const periods = new Map<string, Bucket & { label: string; units: number }>();
    const sources = new Map<string, Bucket>();
    const products = new Map<string, { sku: string; name: string; units: number; revenue: number; orders: number }>();
    const customers = new Map<string, { name: string; orders: number; revenue: number; outstanding: number }>();

    for (const order of orders) {
      const bill = orderTotals(order);
      const add = (b: Bucket) => {
        b.orders += 1;
        b.gross += bill.gross;
        b.discount += bill.discount;
        b.revenue += bill.net;
        b.paid += bill.paid;
        b.outstanding += bill.remaining;
      };
      add(totals);

      let key: string;
      let label: string;
      if (groupBy === 'day') {
        key = tehranDay(order.createdAt);
        label = key;
      } else {
        const { year, month } = jalaliYearMonth(order.createdAt);
        key = `${year}-${String(month).padStart(2, '0')}`;
        label = `${JALALI_MONTHS[month - 1]} ${year}`;
      }
      if (!periods.has(key)) periods.set(key, { ...bucket(), label, units: 0 });
      const slot = periods.get(key)!;
      add(slot);

      const source = order.siteReference || order.wooId != null ? 'site' : 'erp';
      if (!sources.has(source)) sources.set(source, bucket());
      add(sources.get(source)!);

      const customerKey = order.customerId ?? 'walk-in';
      if (!customers.has(customerKey)) customers.set(customerKey, { name: order.customer?.name ?? 'مشتری حضوری', orders: 0, revenue: 0, outstanding: 0 });
      const buyer = customers.get(customerKey)!;
      buyer.orders += 1;
      buyer.revenue += bill.net;
      buyer.outstanding += bill.remaining;

      const seen = new Set<string>();
      for (const line of order.items) {
        const sold = netLineSale(line, order);
        units += sold.units;
        slot.units += sold.units;
        if (!products.has(line.productId)) products.set(line.productId, { sku: line.product?.sku ?? '', name: line.product?.name ?? '', units: 0, revenue: 0, orders: 0 });
        const row = products.get(line.productId)!;
        row.units += sold.units;
        row.revenue += sold.revenue;
        if (!seen.has(line.productId)) row.orders += 1;
        seen.add(line.productId);
      }
    }

    const cap = <T,>(rows: T[]) => (top === null ? rows : rows.slice(0, top));
    const productRows = [...products.values()].sort((a, b) => b.revenue - a.revenue);
    const customerRows = [...customers.values()].sort((a, b) => b.revenue - a.revenue);
    return {
      from: period.from,
      to: period.to,
      firstOrderAt: orders[0]?.createdAt ?? null,
      lastOrderAt: orders.at(-1)?.createdAt ?? null,
      currency: 'TOMAN',
      totals: { ...rounded(totals), units, cancelledOrders: cancelled, averageOrder: totals.orders ? round(totals.revenue / totals.orders) : 0 },
      groupBy,
      byPeriod: [...periods.entries()].map(([key, b]) => ({ period: key, label: b.label, ...rounded(b), units: b.units })),
      bySource: Object.fromEntries([...sources.entries()].map(([source, b]) => [source, rounded(b)])),
      productCount: productRows.length,
      byProduct: cap(productRows).map((p) => ({ ...p, revenue: round(p.revenue) })),
      customerCount: customerRows.length,
      byCustomer: cap(customerRows).map((c) => ({ ...c, revenue: round(c.revenue), outstanding: round(c.outstanding) })),
    };
  });
}
