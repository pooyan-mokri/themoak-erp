import { Decimal } from '@prisma/client/runtime/library';
import { isClosedShort, landedCostPerUnit, receivedValueInToman } from '@/lib/landed-cost';
import { owedInTomanAfterCurrencyPayments } from '@/lib/purchase-order-balance';
import { orderTotals } from '@/lib/order-balance';
import {
  PARTNER_LOAN_CATEGORY,
  PARTNER_LOAN_REPAYMENT_CATEGORY,
  RENT_DEPOSIT_CATEGORY,
  RENT_DEPOSIT_RETURN_CATEGORY,
  profitAmount,
} from '@/lib/profit-rows';

/**
 * Totals of account balances across currencies, for the dashboard's «موجودی کل»
 * and the balance sheet's cash: every account that holds money (bank, cash box,
 * person, crypto wallet; not the EXPENSE-type P&L buckets).
 *
 * A balance is kept in its account's own currency, so a dollar balance of 1,000
 * is 1,000 dollars, not 1,000 Toman. A foreign balance is converted at the latest
 * recorded rate, shown with that rate and its date. A currency with no recorded
 * rate cannot be converted: it is listed on its own and not added.
 */

export type RateRow = { currency: string; rateToToman: unknown; date: Date };

export type CurrencyTotal = {
  currency: string;
  /** The sum of the balances, in this currency. */
  total: number;
  /** Toman per 1 unit, the latest recorded. */
  rate: number;
  rateDate: Date;
  /** total × rate. */
  approxToman: number;
};

export type CashPosition = {
  /** Toman balances plus every foreign balance with a rate, converted. */
  total: number;
  /** The same total by account type (BANK, CASH, PERSON, CRYPTO, …). */
  byType: Array<{ type: string; total: number }>;
  /** Each foreign currency that was converted, with its rate. */
  foreign: CurrencyTotal[];
  /** Foreign currencies with no recorded rate: not in the total. */
  unpriced: Array<{ currency: string; total: number }>;
};

export function cashPosition(
  accounts: Array<{ type: string; currency: string; balance: unknown }>,
  latestRates: RateRow[],
): CashPosition {
  const rateOf = (currency: string) => latestRates.find((rate) => rate.currency === currency);
  const byCurrency = new Map<string, Decimal>();
  const byType = new Map<string, Decimal>();
  let total = new Decimal(0);
  for (const account of accounts) {
    const balance = new Decimal(account.balance as Decimal.Value);
    byCurrency.set(account.currency, (byCurrency.get(account.currency) ?? new Decimal(0)).plus(balance));
    const rate = account.currency === 'TOMAN' ? 1 : rateOf(account.currency)?.rateToToman;
    if (rate === undefined) continue;
    const toman = balance.times(rate as Decimal.Value);
    total = total.plus(toman);
    byType.set(account.type, (byType.get(account.type) ?? new Decimal(0)).plus(toman));
  }
  const foreign: CurrencyTotal[] = [];
  const unpriced: CashPosition['unpriced'] = [];
  for (const [currency, sum] of [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (currency === 'TOMAN') continue;
    const latest = rateOf(currency);
    if (!latest) {
      unpriced.push({ currency, total: Number(sum) });
      continue;
    }
    const rate = Number(latest.rateToToman);
    foreign.push({ currency, total: Number(sum), rate, rateDate: latest.date, approxToman: Number(sum.times(rate)) });
  }
  return {
    total: Number(total),
    byType: [...byType.entries()].map(([type, sum]) => ({ type, total: Number(sum) })),
    foreign,
    unpriced,
  };
}

/** What orderTotals reads of an order (a Prisma select). */
export const ORDER_BALANCE_FIELDS = { totalAmount: true, discount: true, paidAmount: true, wooId: true, siteReference: true } as const;

/** The orders customers owe on: every uncancelled order of a customer (a guest sale is paid at the till). */
export const RECEIVABLE_ORDERS = { customerId: { not: null }, status: { not: 'CANCELLED' } };

/**
 * What customers still owe on their orders, in Toman: each receivable order's
 * remaining (src/lib/order-balance.ts). The dashboard's «مطالبات», the aging
 * report, the balance sheet and the customers' debts all add up to it.
 */
export async function customerReceivables(client: any): Promise<number> {
  const orders = await client.order.findMany({ where: RECEIVABLE_ORDERS, select: ORDER_BALANCE_FIELDS });
  return orders.reduce((sum: number, order: any) => sum + orderTotals(order).remaining, 0);
}

/** In Toman: the EXPENSE rows of `out` less the INCOME rows of `back`. */
async function paidOutLessBack(client: any, out: string, back: string): Promise<number> {
  const rows = await client.transaction.findMany({
    where: {
      OR: [
        { type: 'EXPENSE', category: out },
        { type: 'INCOME', category: back },
      ],
    },
    select: { type: true, category: true, amount: true, amountInToman: true, currency: true },
  });
  let held = new Decimal(0);
  for (const row of rows) {
    const toman = new Decimal(profitAmount(row));
    held = row.type === 'EXPENSE' ? held.plus(toman) : held.minus(toman);
  }
  return Number(held);
}

/**
 * The rent deposits the company holds with landlords, the balance sheet's
 * «ودیعه‌ها», in Toman: the deposits paid (EXPENSE rows «ودیعه اجاره») less
 * the deposits returned (INCOME rows «بازگشت ودیعه»), src/lib/profit-rows.ts.
 */
export function rentDepositsHeld(client: any): Promise<number> {
  return paidOutLessBack(client, RENT_DEPOSIT_CATEGORY, RENT_DEPOSIT_RETURN_CATEGORY);
}

/**
 * What partners still owe the company, the balance sheet's «طلب از شرکا», in
 * Toman: lent (EXPENSE rows «قرض به شریک») less repaid (INCOME rows «بازپرداخت
 * قرض شریک»), src/lib/profit-rows.ts.
 */
export function partnerLoansOutstanding(client: any): Promise<number> {
  return paidOutLessBack(client, PARTNER_LOAN_CATEGORY, PARTNER_LOAN_REPAYMENT_CATEGORY);
}

/**
 * What suppliers owe the company back, the balance sheet's «طلب از تأمین‌کنندگان», in Toman: the sum of the
 * SupplierCredit rows (+ what was paid on an order cancelled, or for units an order closed short never brought;
 * − what such a credit paid on a later order). It never counts twice with prepaid purchases: a cancelled order
 * is not a payable order, an order closed short is RECEIVED (never prepaid), and a credit spent on a later order
 * leaves the credit as it becomes that order's payment (supplierPositions above).
 */
export async function supplierCreditsHeld(client: any): Promise<number> {
  const sum = await client.supplierCredit.aggregate({ _sum: { amount: true } });
  return Number(sum._sum.amount ?? 0);
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
  status: true,
  totalAmountInToman: true,
  payments: { select: { amount: true, orderAmount: true } },
  items: { select: { quantity: true, unitCost: true, currency: true, exchangeRateSnapshot: true, unitCostInToman: true, receivedQuantity: true } },
  additionalCosts: { select: { amount: true, currency: true, exchangeRateSnapshot: true, amountInToman: true } },
};

type Priced = { currency: string; exchangeRateSnapshot?: unknown };

type PurchaseOrderDebt = {
  status?: string;
  totalAmountInToman: unknown;
  payments: Array<{ amount: unknown; orderAmount?: unknown }>;
  items?: Array<Priced & { quantity: number; unitCost: unknown; unitCostInToman?: unknown; receivedQuantity?: number }>;
  additionalCosts?: Array<Priced & { amount: unknown; amountInToman?: unknown }>;
};

/**
 * What is still unpaid on one purchase order, in Toman: its Toman total less
 * its payments (the PurchaseOrderPayment row every payment writes, whose amount
 * is Toman whatever the paying account), never below zero. totalAmount is in
 * the first line's currency and is never used. An order with no Toman total
 * (an old one) is priced as the payment code prices it: its lines and order
 * costs at the latest rate (or, lacking one, the rate kept on the line).
 * Once such an order has a payment in the currency actually paid (payPurchaseOrder
 * on the ERP API), it owes what remains of its own currency, at the latest rate
 * (src/lib/purchase-order-balance.ts): what its earlier payments cost in Toman
 * no longer moves what is left.
 * Arrival costs are paid when recorded, so they are never owed. A remainder of
 * 1 Toman or less is rounding: the payment code marks an order paid at total − 1.
 * An order closed short owes only for the units that came (receivedValueInToman
 * in src/lib/landed-cost.ts, as the close credits the supplier with the rest).
 */
export function unpaidOnPurchaseOrder(order: PurchaseOrderDebt, rates: RateRow[] = []): number {
  const rateOf = (line: Priced) => {
    if (line.currency === 'TOMAN') return new Decimal(1);
    const latest = rates.find((rate) => rate.currency === line.currency);
    return new Decimal((latest?.rateToToman ?? line.exchangeRateSnapshot ?? 0) as Decimal.Value);
  };
  let total = new Decimal((order.totalAmountInToman ?? 0) as Decimal.Value);
  if (order.items && isClosedShort({ status: order.status, items: order.items })) {
    total = new Decimal(receivedValueInToman(order as any, (currency) => Number(rateOf({ currency }))));
  } else if (total.isZero()) {
    for (const item of order.items ?? []) total = total.plus(rateOf(item).times(item.quantity).times(item.unitCost as Decimal.Value));
    for (const cost of order.additionalCosts ?? []) total = total.plus(rateOf(cost).times(cost.amount as Decimal.Value));
  }
  const paid = order.payments.reduce(
    (sum: Decimal, payment) => sum.plus(new Decimal(payment.amount as Decimal.Value)),
    new Decimal(0),
  );
  let unpaid = total.minus(paid);
  if (order.items && !isClosedShort({ status: order.status, items: order.items })) {
    const owed = owedInTomanAfterCurrencyPayments(order as any, (currency) => Number(rateOf({ currency })));
    if (owed !== null) unpaid = new Decimal(owed).minus(paid);
  }
  return unpaid.greaterThan(1) ? Number(unpaid) : 0;
}

/**
 * What the company and its suppliers owe each other on purchase orders, in
 * Toman.
 *
 * - unpaidOnOrders, the dashboard's «مانده پرداخت به تأمین‌کنندگان»: what is
 *   still to pay on every placed, uncancelled order (unpaidOnPurchaseOrder).
 *   An operational figure: an order placed and not yet received or paid is a
 *   commitment, not a liability.
 * - payables and prepaid, the balance sheet's: per order, the value of the
 *   units received so far at their landed Toman cost (src/lib/landed-cost.ts,
 *   the cost receiving rolls into the inventory) against what was paid on it
 *   (its payments and the arrival costs paid when it arrived, which the
 *   landed cost includes). Received beyond paid is owed (payables, orders
 *   received in part or in full); paid beyond received is «پیش‌پرداخت خرید»
 *   (orders not fully received). So placing an order changes nothing on the
 *   balance sheet, paying moves cash into prepaid, and receiving moves prepaid
 *   into the inventory, or makes a payable when unpaid.
 *   An order received the old way (receivePurchaseOrder) has no received
 *   quantities; RECEIVED, it is valued at its whole landed total.
 *
 * `client` is a Prisma client or transaction; `rates` the latest rates, for
 * lines priced in a foreign currency with no Toman snapshot.
 */
export async function supplierPositions(
  client: any,
  rates: RateRow[],
): Promise<{ unpaidOnOrders: number; payables: number; prepaid: number }> {
  const orders = await client.purchaseOrder.findMany({
    where: PAYABLE_PURCHASE_ORDERS,
    select: {
      ...PURCHASE_ORDER_DEBT_FIELDS,
      status: true,
      items: {
        select: { quantity: true, unitCost: true, currency: true, exchangeRateSnapshot: true, unitCostInToman: true, receivedQuantity: true },
      },
      additionalCosts: { select: { amount: true, currency: true, exchangeRateSnapshot: true, amountInToman: true } },
      arrivalAdditionalCosts: { select: { amountInToman: true } },
    },
  });
  const rateOf = (currency: string) => {
    if (currency === 'TOMAN') return 1;
    return Number(rates.find((rate) => rate.currency === currency)?.rateToToman ?? 0);
  };
  let unpaidOnOrders = 0;
  let payables = new Decimal(0);
  let prepaid = new Decimal(0);
  for (const order of orders) {
    unpaidOnOrders += unpaidOnPurchaseOrder(order, rates);

    let paid = new Decimal(0);
    for (const payment of order.payments) paid = paid.plus(new Decimal(payment.amount as Decimal.Value));
    for (const cost of order.arrivalAdditionalCosts) paid = paid.plus(new Decimal((cost.amountInToman ?? 0) as Decimal.Value));

    const anyReceived = order.items.some((item: any) => item.receivedQuantity > 0);
    let received = new Decimal(0);
    if (anyReceived) {
      for (const item of order.items) {
        if (!item.receivedQuantity) continue;
        received = received.plus(new Decimal(landedCostPerUnit(item, order, rateOf)).times(item.receivedQuantity));
      }
    } else if (order.status === 'RECEIVED') {
      const arrival = order.arrivalAdditionalCosts.reduce((sum: number, cost: any) => sum + Number(cost.amountInToman ?? 0), 0);
      received = new Decimal(unpaidOnPurchaseOrder({ ...order, payments: [] }, rates) + arrival);
    }

    const balance = received.minus(paid);
    if (balance.greaterThan(1) && (order.status === 'RECEIVED' || order.status === 'PARTIALLY_RECEIVED')) {
      payables = payables.plus(balance);
    } else if (balance.lessThan(-1) && order.status !== 'RECEIVED') {
      prepaid = prepaid.minus(balance);
    }
  }
  return { unpaidOnOrders, payables: Number(payables), prepaid: Number(prepaid) };
}
