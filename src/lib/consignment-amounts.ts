/**
 * Which orders are settled with a consignment partner.
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
