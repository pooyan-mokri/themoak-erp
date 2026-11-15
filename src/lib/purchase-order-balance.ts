/**
 * A purchase order's balance in its own currency: what it totals, what its payments have settled, what remains.
 * Plain functions with no server imports, shared by the ERP API (src/lib/erp-api-po-payments.ts), the payables
 * (src/lib/money-totals.ts), the order page's payment actions and the page itself.
 *
 * Why the order's currency: an order recorded as the supplier's PI states it (yuan, no Toman figure) is settled
 * when its yuan are paid, whatever each payment cost in Toman on its day.
 *
 * What one payment settles, in the order's currency:
 *   1. a payment recorded by payPurchaseOrder stores it (PurchaseOrderPayment.orderAmount), worked out once, when
 *      it was paid: the amount paid when it was paid in the order's currency; what left the account when the
 *      account is in the order's currency; its Toman value for an order in Toman; otherwise its Toman value at the
 *      order currency's latest rate that day;
 *   2. a payment recorded in Toman (the order page, the supplier's credit, a correction) stores none. It settles
 *      its Toman amount at the order's own rate: 1 for an order in Toman; totalAmountInToman / total for an order
 *      that has a Toman total; otherwise the order currency's latest rate now, as every reader prices such an
 *      order (src/lib/landed-cost.ts owedTotalInToman).
 *
 * An order whose lines and costs are not all in one currency has no balance in a currency: null here, and it is
 * paid in Toman on the order page as before.
 */

type Numeric = number | string | { toString(): string } | null | undefined;

export interface BalanceOrder {
  totalAmountInToman?: Numeric;
  items: Array<{ quantity: Numeric; unitCost: Numeric; currency?: string | null }>;
  additionalCosts?: Array<{ amount?: Numeric; currency?: string | null }> | null;
  payments?: Array<{ amount: Numeric; orderAmount?: Numeric }> | null;
}

export interface OrderBalance {
  currency: string;
  /** Lines and order costs, in the order's currency. */
  total: number;
  paid: number;
  /** Never below 0, and 0 once what is left is within BALANCE_TOLERANCE. */
  remaining: number;
}

/** A payment may leave this much of the order's currency unpaid, or go this much over: the rounding of a conversion. */
export const BALANCE_TOLERANCE = 0.01;

const num = (value: Numeric): number => {
  if (value === null || value === undefined) return 0;
  const n = Number(value as any);
  return Number.isFinite(n) ? n : 0;
};
const present = (value: Numeric) => value !== null && value !== undefined && Number.isFinite(Number(value as any));
/** Six decimals: enough for any currency, and it drops the noise of adding floats. */
const tidy = (n: number) => Math.round(n * 1e6) / 1e6;

/** The one currency of the order's lines and costs; null when they mix currencies or there are no lines. */
export function orderCurrencyOf(order: BalanceOrder): string | null {
  const currencies = new Set([...order.items, ...(order.additionalCosts ?? [])].map((x) => x.currency || 'TOMAN'));
  return order.items.length > 0 && currencies.size === 1 ? [...currencies][0] : null;
}

/** Lines and order costs added up as they are recorded. Meaningful for an order in one currency. */
export function orderTotalOf(order: BalanceOrder): number {
  const lines = order.items.reduce((sum, item) => sum + num(item.quantity) * num(item.unitCost), 0);
  const costs = (order.additionalCosts ?? []).reduce((sum, cost) => sum + num(cost.amount), 0);
  return tidy(lines + costs);
}

/** A payment recorded in the currency actually paid (payPurchaseOrder), not in Toman. */
export const isCurrencyPayment = (payment: { orderAmount?: Numeric }) => present(payment.orderAmount);

/**
 * The order's balance in its currency (see the top of this file), or null for an order in mixed currencies.
 * `rateOf` gives Toman per unit of a currency, latest; it is asked only for a Toman payment on a foreign-currency
 * order with no Toman total. A rate it cannot give (0, NaN) counts that payment as settling nothing.
 */
export function orderBalance(order: BalanceOrder, rateOf: (currency: string) => number): OrderBalance | null {
  const currency = orderCurrencyOf(order);
  if (!currency) return null;
  const total = orderTotalOf(order);
  const tomanTotal = num(order.totalAmountInToman);
  let ownRate: number | null = null;
  const tomanRate = () => {
    if (ownRate === null) ownRate = currency === 'TOMAN' ? 1 : tomanTotal > 0 && total > 0 ? tomanTotal / total : rateOf(currency);
    return ownRate;
  };
  const paid = tidy(
    (order.payments ?? []).reduce((sum, payment) => {
      if (isCurrencyPayment(payment)) return sum + num(payment.orderAmount);
      const rate = tomanRate();
      return rate > 0 ? sum + num(payment.amount) / rate : sum;
    }, 0),
  );
  // Within the tolerance the order is settled: nothing remains.
  const left = tidy(total - paid);
  return { currency, total, paid, remaining: left > BALANCE_TOLERANCE ? left : 0 };
}

/**
 * What an order with no Toman total owes in all, in Toman, once a payment in the currency actually paid is on it:
 * what was paid on it (each payment's own Toman value) plus what remains of its currency at the latest rate. Null
 * when the usual figure applies: an order in Toman or with a Toman total, in mixed currencies, or with Toman
 * payments only (then src/lib/landed-cost.ts owedTotalInToman prices the whole order at the latest rate).
 */
export function owedInTomanAfterCurrencyPayments(order: BalanceOrder, rateOf: (currency: string) => number): number | null {
  if (num(order.totalAmountInToman) > 0 || !(order.payments ?? []).some(isCurrencyPayment)) return null;
  const balance = orderBalance(order, rateOf);
  if (!balance || balance.currency === 'TOMAN') return null;
  const paidInToman = (order.payments ?? []).reduce((sum, payment) => sum + num(payment.amount), 0);
  return paidInToman + balance.remaining * rateOf(balance.currency);
}
