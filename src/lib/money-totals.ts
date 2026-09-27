import { Decimal } from '@prisma/client/runtime/library';

/**
 * Totals of account balances across currencies, for the dashboard and the
 * balance sheet.
 *
 * A balance is kept in its account's own currency, so a dollar balance of 1,000
 * is 1,000 dollars, not 1,000 Toman. The Toman total adds Toman accounts only.
 * Every other currency is totalled on its own and, when a rate is recorded,
 * valued at the latest recorded rate: an approximation, shown with that rate
 * and its date.
 */

export type RateRow = { currency: string; rateToToman: unknown; date: Date };

export type CurrencyTotal = {
  currency: string;
  /** The sum of the balances, in this currency. */
  total: number;
  /** Toman per 1 unit, the latest recorded; null when no rate was ever recorded. */
  rate: number | null;
  rateDate: Date | null;
  /** total × rate, approximate; null without a rate. */
  approxToman: number | null;
};

export type BalanceTotals = { toman: number; foreign: CurrencyTotal[] };

export function totalsByCurrency(
  accounts: Array<{ currency: string; balance: unknown }>,
  latestRates: RateRow[],
): BalanceTotals {
  const sums = new Map<string, Decimal>();
  for (const account of accounts) {
    const balance = new Decimal(account.balance as Decimal.Value);
    sums.set(account.currency, (sums.get(account.currency) ?? new Decimal(0)).plus(balance));
  }
  const foreign = [...sums.entries()]
    .filter(([currency]) => currency !== 'TOMAN')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, sum]) => {
      const latest = latestRates.find((rate) => rate.currency === currency);
      const rate = latest ? Number(latest.rateToToman) : null;
      return {
        currency,
        total: Number(sum),
        rate,
        rateDate: latest?.date ?? null,
        approxToman: rate === null ? null : Number(sum.times(rate)),
      };
    });
  return { toman: Number(sums.get('TOMAN') ?? 0), foreign };
}

/** The latest recorded rate of each currency (`client` is a Prisma client or transaction). */
export async function latestRates(client: any): Promise<RateRow[]> {
  return client.exchangeRate.findMany({
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    distinct: ['currency'],
    select: { currency: true, rateToToman: true, date: true },
  });
}

/**
 * Purchase orders that owe their supplier: every order past its draft that was
 * not cancelled. A draft has not been placed with the supplier yet. Whether
 * one still owes anything is read from its payments, never from its status.
 */
export const PAYABLE_PURCHASE_ORDERS = { status: { notIn: ['DRAFT', 'CANCELLED'] } };

/** What the payables reader needs of an order (a Prisma select). */
export const PURCHASE_ORDER_DEBT_FIELDS = {
  totalAmountInToman: true,
  payments: { select: { amount: true } },
  items: { select: { quantity: true, unitCost: true, currency: true, exchangeRateSnapshot: true } },
  additionalCosts: { select: { amount: true, currency: true, exchangeRateSnapshot: true } },
};

type Priced = { currency: string; exchangeRateSnapshot?: unknown };

type PurchaseOrderDebt = {
  totalAmountInToman: unknown;
  payments: Array<{ amount: unknown }>;
  items?: Array<Priced & { quantity: number; unitCost: unknown }>;
  additionalCosts?: Array<Priced & { amount: unknown }>;
};

/**
 * What is still unpaid on one purchase order, in Toman: its Toman total less
 * its payments (the PurchaseOrderPayment row every payment writes, whose amount
 * is Toman whatever the paying account), never below zero. totalAmount is in
 * the first line's currency and is never used. An order with no Toman total
 * (an old one) is priced as the payment code prices it: its lines and order
 * costs at the latest rate (or, lacking one, the rate kept on the line).
 * Arrival costs are paid when recorded, so they are never owed. A remainder of
 * 1 Toman or less is rounding: the payment code marks an order paid at total − 1.
 */
export function unpaidOnPurchaseOrder(order: PurchaseOrderDebt, rates: RateRow[] = []): number {
  const rateOf = (line: Priced) => {
    if (line.currency === 'TOMAN') return new Decimal(1);
    const latest = rates.find((rate) => rate.currency === line.currency);
    return new Decimal((latest?.rateToToman ?? line.exchangeRateSnapshot ?? 0) as Decimal.Value);
  };
  let total = new Decimal((order.totalAmountInToman ?? 0) as Decimal.Value);
  if (total.isZero()) {
    for (const item of order.items ?? []) total = total.plus(rateOf(item).times(item.quantity).times(item.unitCost as Decimal.Value));
    for (const cost of order.additionalCosts ?? []) total = total.plus(rateOf(cost).times(cost.amount as Decimal.Value));
  }
  const paid = order.payments.reduce(
    (sum: Decimal, payment) => sum.plus(new Decimal(payment.amount as Decimal.Value)),
    new Decimal(0),
  );
  const unpaid = total.minus(paid);
  return unpaid.greaterThan(1) ? Number(unpaid) : 0;
}
