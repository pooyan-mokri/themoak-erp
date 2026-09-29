/**
 * The orders sales analytics count as sold: every order but a cancelled one
 * and a legacy PENDING one. An order is COMPLETED at checkout and INVOICED
 * once invoiced (both sold); PENDING was written only by the old WooCommerce
 * sync, for a web order the store left unpaid or on hold.
 */
export const SOLD_ORDER_STATUS = { notIn: ['CANCELLED', 'PENDING'] };

/** An order's status in Persian, the same on every screen and export that shows it. */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  COMPLETED: 'تکمیل شده',
  INVOICED: 'فاکتور شده',
  PENDING: 'در انتظار',
  CANCELLED: 'لغو شده',
};

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status] ?? status;
}
