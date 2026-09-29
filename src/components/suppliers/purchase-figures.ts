/**
 * Purchase orders as the screens show them: each status as a word and a colour
 * (design system §12), and the figures computed from the orders the page loads.
 * Plain functions, used by server pages and client components alike.
 */

export const PURCHASE_STATUSES: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: 'پیش‌نویس', tone: 'bg-brand-soft text-brand' },
  PENDING_PAYMENT: { label: 'منتظر پرداخت', tone: 'bg-warning-soft text-warning' },
  PARTIALLY_PAID: { label: 'پرداخت جزئی', tone: 'bg-warning-soft text-warning' },
  PAID: { label: 'پرداخت شده', tone: 'bg-brand-soft text-brand' },
  IN_PRODUCTION: { label: 'در حال تولید', tone: 'bg-brand-soft text-brand' },
  ARRIVED: { label: 'رسیده به مقصد', tone: 'bg-brand-soft text-brand' },
  PARTIALLY_RECEIVED: { label: 'نیمه دریافت شده', tone: 'bg-brand-soft text-brand' },
  RECEIVED: { label: 'دریافت شده', tone: 'bg-success-soft text-success' },
  CANCELLED: { label: 'لغو شده', tone: 'bg-danger-soft text-danger' },
};

export const purchaseStatus = (status: string) =>
  PURCHASE_STATUSES[status] ?? { label: status, tone: 'bg-secondary text-muted-foreground' };

export const CURRENCY_LABELS: Record<string, string> = { TOMAN: 'تومان', USD: 'دلار', EUR: 'یورو', CNY: 'یوان' };

type Order = {
  status: string;
  createdAt: Date | string;
  supplierId?: string;
  supplier?: { id?: string; name: string };
  totalAmount?: number;
  totalAmountInToman?: number;
  paidAmountInToman?: number;
  /** What is still owed on the order (src/lib/money-totals.ts unpaidOnPurchaseOrder); finance.view only. */
  unpaidInToman?: number;
  items: Array<{ receivedDate?: Date | string | null }>;
};

/** Not yet received in full and not cancelled. */
export const isOpen = (o: Pick<Order, 'status'>) => o.status !== 'RECEIVED' && o.status !== 'CANCELLED';

/** Paid for and being made or shipped: after payment, before arrival. */
export const isInTransit = (o: Pick<Order, 'status'>) => o.status === 'IN_PRODUCTION';

/** Arrived, or partly received: waiting on the warehouse. */
export const awaitsReceipt = (o: Pick<Order, 'status'>) => o.status === 'ARRIVED' || o.status === 'PARTIALLY_RECEIVED';

/**
 * What is still owed to the supplier on an order (Toman), as the dashboard's «مانده پرداخت به تأمین‌کنندگان»
 * counts it (unpaidOnPurchaseOrder in src/lib/money-totals.ts, which getPurchaseOrders sends): its total less
 * its payments, only for the units that came on an order closed short; nothing on a draft or a cancelled order.
 * Undefined without finance.view.
 */
export function payableOf(o: Order): number | undefined {
  if (o.unpaidInToman === undefined) return undefined;
  if (o.status === 'DRAFT' || o.status === 'CANCELLED') return 0;
  return o.unpaidInToman;
}

/** Days from the order's creation to the last receipt, for an order received in full. */
export function leadTimeDays(o: Order): number | undefined {
  if (o.status !== 'RECEIVED') return undefined;
  const received = o.items.map((i) => (i.receivedDate ? new Date(i.receivedDate).getTime() : 0)).filter(Boolean);
  if (received.length === 0) return undefined;
  return Math.max(0, (Math.max(...received) - new Date(o.createdAt).getTime()) / 86_400_000);
}

/** The strip of figures on the purchase pages. Money only when the orders carry it (finance.view). */
export function purchaseFigures(orders: Order[]) {
  const open = orders.filter(isOpen);
  const leads = orders.map(leadTimeDays).filter((d): d is number => d !== undefined);
  const payables = orders.map(payableOf);
  const seesMoney = payables.some((p) => p !== undefined);
  const owing = orders.filter((o) => (payableOf(o) ?? 0) > 0);
  return {
    open: open.length,
    // In Toman: totalAmount is in the order's first currency and is never added up (src/lib/money-totals.ts).
    openValue: open.reduce((sum, o) => sum + Number(o.totalAmountInToman ?? 0), 0),
    inTransit: orders.filter(isInTransit).length,
    awaitingReceipt: orders.filter(awaitsReceipt).length,
    payable: seesMoney ? payables.reduce<number>((sum, p) => sum + (p ?? 0), 0) : undefined,
    suppliersOwed: new Set(owing.map((o) => o.supplierId ?? o.supplier?.id ?? o.supplier?.name)).size,
    leadTimeDays: leads.length ? leads.reduce((sum, d) => sum + d, 0) / leads.length : undefined,
    leadTimeOrders: leads.length,
  };
}

/** Each supplier's balance: what is still owed on its orders (Toman). */
export function supplierBalances(orders: Order[]): Record<string, number> {
  const balances: Record<string, number> = {};
  for (const o of orders) {
    const id = o.supplierId ?? o.supplier?.id;
    if (!id) continue;
    balances[id] = (balances[id] ?? 0) + (payableOf(o) ?? 0);
  }
  return balances;
}
