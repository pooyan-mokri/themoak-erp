/**
 * Purchase-order statuses: the moves updatePurchaseOrderStatus accepts, and their Persian names. Plain data
 * with no server imports, so the order page offers exactly the moves the server allows.
 *
 * Only procurement steps and cancelling move by hand. PAID and PARTIALLY_PAID come only from recording
 * payments, ARRIVED also from recording the arrival, PARTIALLY_RECEIVED and RECEIVED only from receiving goods
 * (Pooyan's decision: money paid outside the ERP is recorded as a payment from an account).
 */
export const PURCHASE_ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ['PENDING_PAYMENT', 'CANCELLED'],
  PENDING_PAYMENT: ['CANCELLED'],
  PARTIALLY_PAID: ['CANCELLED'],
  PAID: ['IN_PRODUCTION', 'CANCELLED'],
  IN_PRODUCTION: ['ARRIVED', 'CANCELLED'],
  ARRIVED: ['CANCELLED'],
  PARTIALLY_RECEIVED: [],
  RECEIVED: [],
  CANCELLED: [],
};

/** The action that alone sets these statuses. */
export const PURCHASE_ORDER_STATUS_SET_BY: Record<string, string> = {
  PARTIALLY_PAID: 'ثبت پرداخت',
  PAID: 'ثبت پرداخت',
  PARTIALLY_RECEIVED: 'دریافت کالا',
  RECEIVED: 'دریافت کالا',
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
