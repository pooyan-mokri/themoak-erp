/**
 * Purchase-order statuses: the moves updatePurchaseOrderStatus accepts, and their Persian names. Plain data
 * with no server imports, so the order page offers exactly the moves the server allows.
 *
 * PARTIALLY_RECEIVED and RECEIVED are written by receiving goods, PAID and PARTIALLY_PAID normally by
 * payments, ARRIVED by recording the arrival; none of them moves on from a receipt by hand.
 */
export const PURCHASE_ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ['PENDING_PAYMENT', 'CANCELLED'],
  PENDING_PAYMENT: ['PARTIALLY_PAID', 'PAID', 'CANCELLED'],
  PARTIALLY_PAID: ['PAID', 'CANCELLED'],
  PAID: ['IN_PRODUCTION', 'CANCELLED'],
  IN_PRODUCTION: ['ARRIVED', 'CANCELLED'],
  ARRIVED: ['RECEIVED', 'CANCELLED'],
  PARTIALLY_RECEIVED: [],
  RECEIVED: [],
  CANCELLED: [],
};

export const PURCHASE_ORDER_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'پیش‌نویس',
  PENDING_PAYMENT: 'منتظر پرداخت',
  PARTIALLY_PAID: 'پرداخت جزئی',
  PAID: 'پرداخت شده',
  IN_PRODUCTION: 'در حال تولید',
  ARRIVED: 'رسیده به مقصد',
  PARTIALLY_RECEIVED: 'نیمه دریافت شده',
  RECEIVED: 'دریافت شده',
  CANCELLED: 'لغو شده',
};

export function canMovePurchaseOrder(from: string, to: string): boolean {
  return PURCHASE_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}
