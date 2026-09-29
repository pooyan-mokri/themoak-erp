import { orderNet } from '@/lib/order-balance';
import { addDays, tehranDay, tehranDayStart } from '@/lib/tehran-day';

/**
 * The website's orders as the site page shows them, from the ERP's own orders
 * (every order with a siteReference). Plain functions, run on the server page.
 */

export type SiteOrderRow = {
  id: string;
  number: number;
  reference: string;
  customer: string;
  /** Total less discount, Toman. */
  final: number;
  status: string;
  paymentStatus: string;
  createdAt: Date;
};

export type SiteOrderSummary = {
  /** Site orders not cancelled, placed since midnight. */
  today: number;
  /** The same over the last 7 days, today included. */
  week: number;
  /** What those 7 days of orders came to (total less discount), Toman. */
  revenue7d: number;
  /** Every site order the ERP holds. */
  total: number;
  recent: SiteOrderRow[];
};

type Order = {
  wooId?: number | null;
  id: string;
  number: number;
  siteReference?: string | null;
  status: string;
  paymentStatus: string;
  totalAmount: number;
  discount?: number | null;
  createdAt: Date | string;
  customer?: { name: string } | null;
};

export function siteOrderSummary(orders: Order[], now: Date = new Date(), recent = 8): SiteOrderSummary {
  const site = orders
    .filter((o) => !!o.siteReference)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  // Days are Tehran's (src/lib/tehran-day.ts): the server runs in UTC.
  const todayInTehran = tehranDay(now);
  const today = tehranDayStart(todayInTehran);
  const weekStart = tehranDayStart(addDays(todayInTehran, -6));
  // What the customer pays: the total after the discount (src/lib/order-balance.ts).
  const final = (o: Order) => orderNet(o);
  const live = site.filter((o) => o.status !== 'CANCELLED');
  const week = live.filter((o) => new Date(o.createdAt) >= weekStart);
  return {
    today: live.filter((o) => new Date(o.createdAt) >= today).length,
    week: week.length,
    revenue7d: week.reduce((sum, o) => sum + final(o), 0),
    total: site.length,
    recent: site.slice(0, recent).map((o) => ({
      id: o.id,
      number: o.number,
      reference: o.siteReference as string,
      customer: o.customer?.name ?? 'مشتری سایت',
      final: final(o),
      status: o.status,
      paymentStatus: o.paymentStatus,
      createdAt: new Date(o.createdAt),
    })),
  };
}
