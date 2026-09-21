/**
 * What a return or an exchange does to an order's money, in Toman.
 *
 * The server actions (order-return.ts, order-exchange.ts) book exactly what
 * these functions return, and the return and exchange dialogs show exactly
 * the same figures before the cashier saves, so the screen and the ledger
 * cannot disagree about the cash that moves.
 *
 * Order.totalAmount is the goods total before the discount. On a consignment
 * sale it is already net of the partner's commission while each line keeps
 * its gross unit price, so a line is worth price × (1 − rate) to the order.
 *
 * Deliberately not a 'use server' file: plain functions, used on both sides.
 */

/** The server's cash figure differs from the one the dialog showed. */
export const CASH_CHANGED_MESSAGE =
  'مبلغ این سفارش از زمان باز شدن فرم تغییر کرده است؛ فرم را ببندید و دوباره باز کنید.';

export type OrderMoney = {
  totalAmount: number;
  discount: number;
  paidAmount: number;
  /** The consignment partner's commission in percent; 0 for an ordinary sale. */
  commissionRate: number;
};

export type PaymentStatus = 'PAID' | 'PARTIAL' | 'UNPAID';

export type OrderChange = {
  newTotal: number;
  newPaid: number;
  paymentStatus: PaymentStatus;
  /** Cash received into the chosen account now. */
  cashIn: number;
  /** Cash paid back out of the chosen account now. */
  cashOut: number;
};

/** The money fields of an order row as Prisma returns them. */
export function orderMoney(order: {
  totalAmount: unknown;
  discount?: unknown;
  paidAmount?: unknown;
  commissions?: Array<{ commissionRate: unknown }>;
}): OrderMoney {
  return {
    totalAmount: Number(order.totalAmount),
    discount: Number(order.discount ?? 0),
    paidAmount: Number(order.paidAmount ?? 0),
    commissionRate: order.commissions?.[0] ? Number(order.commissions[0].commissionRate) : 0,
  };
}

/** What `quantity` units at `unitPrice` add to Order.totalAmount (as the sale computed its net). */
export function lineValue(order: Pick<OrderMoney, 'commissionRate'>, unitPrice: number, quantity: number): number {
  const gross = unitPrice * quantity;
  return gross - (gross * order.commissionRate) / 100;
}

function statusOf(netOwed: number, paid: number): PaymentStatus {
  if (netOwed - paid > 0) return paid > 0 ? 'PARTIAL' : 'UNPAID';
  return 'PAID';
}

/**
 * Goods worth `value` come back. Only what the customer has paid beyond the
 * new net total goes back as cash; the rest just lowers the customer's debt.
 */
export function returnChange(order: OrderMoney, value: number): OrderChange {
  const newTotal = Math.max(0, order.totalAmount - value);
  const netOwed = Math.max(0, newTotal - order.discount);
  const newPaid = Math.min(order.paidAmount, netOwed);
  return { newTotal, newPaid, paymentStatus: statusOf(netOwed, newPaid), cashIn: 0, cashOut: order.paidAmount - newPaid };
}

/**
 * Of a positive exchange difference, the most the cashier may collect now:
 * what the customer owes on the order after the exchange, at most the
 * difference. A credit the customer holds on the order pays first.
 */
export function receivableNow(order: OrderMoney, difference: number): number {
  if (difference <= 0) return 0;
  const netOwed = Math.max(0, Math.max(0, order.totalAmount + difference) - order.discount);
  return Math.max(0, Math.min(difference, netOwed - order.paidAmount));
}

/**
 * The new goods are worth `difference` more (or, when negative, less) than
 * the goods given back.
 * - More: the difference is owed on the order, except `receivedNow`
 *   (0..receivableNow) that the cashier collects now.
 * - Less: what the customer paid beyond the new net total is paid back only
 *   when the cashier chooses `refundNow`; otherwise it stays paid on the
 *   order, as the customer's credit.
 */
export function exchangeChange(
  order: OrderMoney,
  difference: number,
  choice: { receivedNow?: number; refundNow?: boolean },
): OrderChange {
  const newTotal = Math.max(0, order.totalAmount + difference);
  const netOwed = Math.max(0, newTotal - order.discount);
  let newPaid = order.paidAmount;
  let cashIn = 0;
  let cashOut = 0;
  if (difference > 0) {
    cashIn = choice.receivedNow ?? 0;
    newPaid = order.paidAmount + cashIn;
  } else if (difference < 0 && choice.refundNow && order.paidAmount > netOwed) {
    cashOut = order.paidAmount - netOwed;
    newPaid = netOwed;
  }
  return { newTotal, newPaid, paymentStatus: statusOf(netOwed, newPaid), cashIn, cashOut };
}

/** Units of a line still sold: bought, less those returned or exchanged away. */
export function effectiveQuantity(line: {
  quantity: number;
  returns?: Array<{ quantity: number }>;
  exchanges?: Array<{ quantity: number }>;
}): number {
  const back = [...(line.returns ?? []), ...(line.exchanges ?? [])].reduce((sum, row) => sum + row.quantity, 0);
  return Math.max(0, line.quantity - back);
}

/**
 * A consignment settlement counted from the units still sold, so returned and
 * exchanged units are neither owed by the partner nor charged commission.
 * Needs the order's items with their `returns` and `exchanges`.
 */
export function consignmentAmounts(order: {
  items: Array<{ quantity: number; price: unknown; returns?: Array<{ quantity: number }>; exchanges?: Array<{ quantity: number }> }>;
  commissions?: Array<{ commissionRate: unknown }>;
  discount?: unknown;
  paidAmount?: unknown;
}) {
  const grossAmount = order.items.reduce((sum, item) => sum + effectiveQuantity(item) * Number(item.price), 0);
  const commissionRate = order.commissions?.[0] ? Number(order.commissions[0].commissionRate) : 0;
  const commissionAmount = (grossAmount * commissionRate) / 100;
  const netAmount = grossAmount - commissionAmount - Number(order.discount ?? 0);
  const paidAmount = Number(order.paidAmount ?? 0);
  return { grossAmount, commissionRate, commissionAmount, netAmount, paidAmount, remainingAmount: netAmount - paidAmount };
}
