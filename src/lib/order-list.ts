import { formatJalaliDateTime } from '@/lib/date-utils';

/**
 * The sales history list: its filters and its Excel rows, computed here so
 * the table and the export show the same figures.
 * Pure (no server imports), so the list component and the tests share it.
 */

type ListedOrder = {
  number: number;
  createdAt: Date | string;
  status: string;
  paymentStatus: string;
  totalAmount: unknown;
  discount?: unknown;
  paidAmount?: unknown;
  wooId?: number | null;
  siteReference?: string | null;
  customer?: { name?: string | null } | null;
  items: Array<{ quantity: number; warehouse?: { id: string } | null }>;
};

/** The price after the discount. */
export function orderFinalAmount(order: Pick<ListedOrder, 'totalAmount' | 'discount'>): number {
  return Number(order.totalAmount) - Number(order.discount || 0);
}

/** What is still owed on an order: the price after the discount less what was paid; nothing on a cancelled order. */
export function orderRemaining(order: Pick<ListedOrder, 'status' | 'totalAmount' | 'discount' | 'paidAmount'>): number {
  if (order.status === 'CANCELLED') return 0;
  return orderFinalAmount(order) - Number(order.paidAmount || 0);
}

export type OrderFilters = {
  from?: Date;
  to?: Date;
  customer?: string;
  paymentStatus?: string;
  minAmount?: string;
  maxAmount?: string;
  warehouse?: string;
};

/** The orders the advanced filter keeps. Days are the viewer's own calendar days. */
export function filterOrders<T extends ListedOrder>(orders: T[], filters: OrderFilters): T[] {
  const { from, to, customer, paymentStatus = 'all', minAmount, maxAmount, warehouse = 'all' } = filters;
  return orders.filter((order) => {
    if (from) {
      const start = new Date(from); start.setHours(0, 0, 0, 0);
      if (new Date(order.createdAt) < start) return false;
    }
    if (to) {
      const end = new Date(to); end.setHours(23, 59, 59, 999);
      if (new Date(order.createdAt) > end) return false;
    }
    if (customer && !order.customer?.name?.toLowerCase().includes(customer.toLowerCase())) return false;
    if (paymentStatus !== 'all' && order.paymentStatus !== paymentStatus) return false;
    const finalAmount = orderFinalAmount(order);
    if (minAmount && finalAmount < Number(minAmount)) return false;
    if (maxAmount && finalAmount > Number(maxAmount)) return false;
    if (warehouse !== 'all' && !order.items.some((item) => item.warehouse?.id === warehouse)) return false;
    return true;
  });
}

/** One order as a row of the Excel export. */
export function orderExportRow(order: ListedOrder) {
  return {
    'شماره سفارش': order.number,
    'مشتری': order.customer?.name || 'مشتری عمومی',
    'مبلغ کل (تومان)': Number(order.totalAmount),
    'تخفیف (تومان)': Number(order.discount || 0),
    'مبلغ پرداختی (تومان)': Number(order.paidAmount || 0),
    'باقیمانده (تومان)': orderRemaining(order),
    'وضعیت پرداخت': order.paymentStatus === 'PAID' ? 'پرداخت شده' :
                    order.paymentStatus === 'PARTIAL' ? 'پرداخت جزئی' : 'پرداخت نشده',
    'تعداد اقلام': order.items.reduce((acc, item) => acc + item.quantity, 0),
    'وضعیت سفارش': order.status === 'COMPLETED' ? 'تکمیل شده' :
                   order.status === 'CANCELLED' ? 'لغو شده' : 'در انتظار',
    'تاریخ': formatJalaliDateTime(order.createdAt),
    'منبع': order.siteReference ? 'سایت' : order.wooId ? 'WooCommerce' : 'سیستم',
  };
}
