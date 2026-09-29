/**
 * An order's bill and a customer's balance, in Toman, the same on every
 * screen: the invoice and its print, the order page, the customer's profile,
 * the debtors list and calculateCustomerDebt.
 *
 * Deliberately not a 'use server' file: plain functions, used on both sides.
 */

type BillSource = {
  totalAmount: unknown;
  discount?: unknown;
  paidAmount?: unknown;
  wooId?: unknown;
  siteReference?: unknown;
};

/** Below half a Toman, a difference is rounding, not money owed. */
const TOLERANCE = 0.5;

/**
 * An order from the old WooCommerce store stored its total after the discount
 * (the store's `total`), with the discount beside it; every other order stores
 * the goods total before the discount.
 */
function totalIsAfterDiscount(order: BillSource): boolean {
  return order.wooId != null && order.siteReference == null;
}

export type OrderTotals = {
  /** Before the discount. */
  gross: number;
  discount: number;
  /** What the customer has to pay: gross less discount, never negative. */
  net: number;
  paid: number;
  /** Still owed on the order. */
  remaining: number;
  /** Paid beyond the net («بستانکار»). */
  credit: number;
};

export function orderTotals(order: BillSource): OrderTotals {
  const discount = Number(order.discount ?? 0);
  const stored = Number(order.totalAmount);
  const gross = totalIsAfterDiscount(order) ? stored + discount : stored;
  const net = Math.max(0, gross - discount);
  const paid = Number(order.paidAmount ?? 0);
  const over = paid - net;
  return {
    gross,
    discount,
    net,
    paid,
    remaining: over < -TOLERANCE ? -over : 0,
    credit: over > TOLERANCE ? over : 0,
  };
}

/** What the customer has to pay on the order. */
export function orderNet(order: BillSource): number {
  return orderTotals(order).net;
}

/**
 * A customer's debt and credit over their orders.
 * - debt: what is still owed, order by order, on orders that are not cancelled;
 * - credit: `creditBalance` (the customer's credit account) plus what was paid
 *   beyond the net on orders that are not cancelled.
 * A cancelled order is neither.
 */
export function customerBalance(
  orders: Array<BillSource & { status?: unknown }>,
  creditBalance = 0,
): { debt: number; credit: number } {
  let debt = 0;
  let credit = creditBalance;
  for (const order of orders) {
    if (order.status === 'CANCELLED') continue;
    const totals = orderTotals(order);
    debt += totals.remaining;
    credit += totals.credit;
  }
  return { debt, credit };
}

export type SettlementPart = { label: string; amount: number };

/**
 * What became of an exchange's difference, for the order's history:
 * `difference` is what the exchange added to the bill (+) or took off it (−);
 * `cashIn` / `cashOut` the cash that moved with it; `toCredit` what went to
 * the customer's credit instead of back to them.
 */
export function exchangeSettlement(x: {
  difference: number;
  cashIn: number;
  cashOut: number;
  toCredit: number;
}): SettlementPart[] {
  const parts: SettlementPart[] = [];
  const add = (label: string, amount: number) => {
    if (amount > TOLERANCE) parts.push({ label, amount });
  };
  if (x.difference > TOLERANCE) {
    add('دریافت‌شده', x.cashIn);
    add('به بدهی اضافه شد', x.difference - x.cashIn);
  } else if (x.difference < -TOLERANCE) {
    add('پس داده شد', x.cashOut);
    add('به اعتبار مشتری', x.toCredit);
    add('از بدهی کم شد', -x.difference - x.cashOut - x.toCredit);
  }
  return parts;
}
