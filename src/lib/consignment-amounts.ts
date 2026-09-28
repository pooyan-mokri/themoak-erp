import { effectiveQuantity } from '@/lib/return-math';

/**
 * Which orders are settled with a consignment partner, and for how much.
 *
 * Only the goods a partner sold out of its own consignment stock, and reported
 * (recordConsignmentSales), are settled with it: their lines come from the
 * partner's virtual warehouse. A sale rung up at the POS to a partner is an
 * ordinary sale from one of our own warehouses, and the partner owes its full
 * price like any customer, through «ثبت پرداخت».
 *
 * An order counts as a consignment order unless every line is known to come
 * from a warehouse of our own: a line from before OrderItem.warehouseId was
 * recorded (null) keeps an older consignment order on the settlement list.
 * Pure (no server imports), so client components can share it.
 */

/** A Prisma `where` for the orders settled with a partner. */
export const CONSIGNMENT_ORDER = { NOT: { items: { every: { warehouse: { isVirtual: false } } } } };

/** The same test on an order whose items carry their warehouse (or null). */
export function isConsignmentOrder(order: { items: Array<{ warehouse?: { isVirtual: boolean } | null }> }): boolean {
  return order.items.some((item) => !item.warehouse || item.warehouse.isVirtual);
}

export const NOT_CONSIGNMENT_MESSAGE =
  'این سفارش فروش امانی نیست؛ همکار بهای کامل آن را مثل هر مشتری می‌پردازد. پرداخت آن را از «ثبت پرداخت» در تاریخچه سفارشات ثبت کنید.';

/**
 * A consignment sale's money. The discount comes off first and the partner's
 * commission is taken on what is left: 10,000,000 with 1,000,000 off at 20%
 * is 9,000,000 sold, 1,800,000 commission and 7,200,000 owed to us.
 * - grossAmount: the sale after the discount (never below 0)
 * - storedTotal: what Order.totalAmount holds for it, net of the commission
 *   and before the discount (Order.totalAmount is always before the discount)
 */
export function consignmentSplit(goodsTotal: number, discount: number, rate: number) {
  const grossAmount = Math.max(0, goodsTotal - discount);
  const commissionAmount = (grossAmount * rate) / 100;
  const netAmount = grossAmount - commissionAmount;
  return { grossAmount, commissionRate: rate, commissionAmount, netAmount, storedTotal: netAmount + discount };
}

/**
 * A consignment order's settlement, counted over the units still sold, so
 * returned and exchanged units are neither owed nor commissioned. Needs the
 * order's items with their `returns` and `exchanges`.
 */
export function settlementAmounts(order: {
  items: Array<{ quantity: number; price: unknown; returns?: Array<{ quantity: number }>; exchanges?: Array<{ quantity: number }> }>;
  commissions?: Array<{ commissionRate: unknown }>;
  discount?: unknown;
  paidAmount?: unknown;
}) {
  const goods = order.items.reduce((sum, item) => sum + effectiveQuantity(item) * Number(item.price), 0);
  const rate = order.commissions?.[0] ? Number(order.commissions[0].commissionRate) : 0;
  const split = consignmentSplit(goods, Number(order.discount ?? 0), rate);
  const paidAmount = Number(order.paidAmount ?? 0);
  return { ...split, paidAmount, remainingAmount: split.netAmount - paidAmount };
}
