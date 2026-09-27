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
  /** Order.discount after the change: goods that come back take their share of it with them. */
  newDiscount: number;
  newPaid: number;
  paymentStatus: PaymentStatus;
  /** Cash received into the chosen account now. */
  cashIn: number;
  /** Cash paid back out of the chosen account now. */
  cashOut: number;
  /** Moved to the customer's credit account (CustomerCredit) instead of paid back. */
  creditIn: number;
  /** How much the customer's bill (total less discount) moved: + owes more, − owes less. */
  owedChange: number;
};

/**
 * The money fields of an order row as Prisma returns them.
 *
 * The commission is netted only for an order whose total is stored net of it.
 * A consignment-report sale is (its commission row is written settled, isPaid);
 * a POS sale to a partner is stored gross until a settlement normalises it to
 * net. With the items (and their returns and exchanges) at hand, the stored
 * total itself says which: it sits nearer the net than the gross of the units
 * still sold. Without them, the commission row's isPaid decides.
 */
export function orderMoney(order: {
  totalAmount: unknown;
  discount?: unknown;
  paidAmount?: unknown;
  commissions?: Array<{ commissionRate: unknown; isPaid?: unknown }>;
  items?: Array<{ quantity: number; price: unknown; returns?: Array<{ quantity: number }>; exchanges?: Array<{ quantity: number }> }>;
}): OrderMoney {
  const commission = order.commissions?.[0];
  const rate = commission ? Number(commission.commissionRate) : 0;
  const totalAmount = Number(order.totalAmount);
  let storedNet = false;
  if (rate > 0) {
    if (order.items) {
      const gross = order.items.reduce((sum, item) => sum + effectiveQuantity(item) * Number(item.price), 0);
      storedNet = Math.abs(totalAmount - gross * (1 - rate / 100)) < Math.abs(totalAmount - gross);
    } else {
      storedNet = !!commission?.isPaid;
    }
  }
  return {
    totalAmount,
    discount: Number(order.discount ?? 0),
    paidAmount: Number(order.paidAmount ?? 0),
    commissionRate: storedNet ? rate : 0,
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
 * The part of the order discount that goods worth `value` take with them when
 * they come back: value × discount ÷ total (the total before they come back),
 * in whole Toman, never more than the discount there is.
 */
export function discountShare(order: Pick<OrderMoney, 'totalAmount' | 'discount'>, value: number): number {
  if (!(order.discount > 0) || !(order.totalAmount > 0) || !(value > 0)) return 0;
  return Math.min(order.discount, Math.round((value * order.discount) / order.totalAmount));
}

/**
 * The order's total and discount once goods worth `returnedValue` come back
 * and goods worth `newValue` go out in their place (0 for a plain return).
 * The returned goods take their discount share with them; the new goods carry
 * none. The discount never exceeds the total, so the net is never negative.
 */
function afterSwap(order: OrderMoney, returnedValue: number, newValue: number) {
  const newTotal = Math.max(0, order.totalAmount - returnedValue + newValue);
  const newDiscount = Math.max(0, Math.min(order.discount - discountShare(order, returnedValue), newTotal));
  const netOwed = newTotal - newDiscount;
  const owedChange = netOwed - Math.max(0, order.totalAmount - order.discount);
  return { newTotal, newDiscount, netOwed, owedChange };
}

/**
 * Goods worth `value` come back, less their share of the discount. Only what
 * the customer has paid beyond the new net total goes back as cash; the rest
 * just lowers the customer's debt.
 */
export function returnChange(order: OrderMoney, value: number): OrderChange {
  const { newTotal, newDiscount, netOwed, owedChange } = afterSwap(order, value, 0);
  const newPaid = Math.min(order.paidAmount, netOwed);
  return {
    newTotal,
    newDiscount,
    newPaid,
    paymentStatus: statusOf(netOwed, newPaid),
    cashIn: 0,
    cashOut: order.paidAmount - newPaid,
    creditIn: 0,
    owedChange,
  };
}

/**
 * Of what an exchange adds to the bill (goods worth `newValue` out for goods
 * worth `returnedValue` back), the most the cashier may collect now: what the
 * customer owes on the order after the exchange, at most that addition. A
 * credit the customer holds on the order pays first.
 */
export function receivableNow(order: OrderMoney, returnedValue: number, newValue: number): number {
  const { netOwed, owedChange } = afterSwap(order, returnedValue, newValue);
  if (owedChange <= 0) return 0;
  return Math.max(0, Math.min(owedChange, netOwed - order.paidAmount));
}

/**
 * Goods worth `newValue` go out for goods worth `returnedValue` back; the
 * returned goods take their discount share with them.
 * - The bill grows: the addition is owed on the order, except `receivedNow`
 *   (0..receivableNow) that the cashier collects now.
 * - The bill shrinks: what the customer paid beyond the new net total is paid
 *   back when the cashier chooses `refundNow`, or moved to the customer's
 *   credit account with `toCredit`; the order is then paid exactly its net.
 *   With neither it stays paid on the order (as before credit accounts).
 */
export function exchangeChange(
  order: OrderMoney,
  returnedValue: number,
  newValue: number,
  choice: { receivedNow?: number; refundNow?: boolean; toCredit?: boolean },
): OrderChange {
  const { newTotal, newDiscount, netOwed, owedChange } = afterSwap(order, returnedValue, newValue);
  let newPaid = order.paidAmount;
  let cashIn = 0;
  let cashOut = 0;
  let creditIn = 0;
  if (owedChange > 0) {
    cashIn = choice.receivedNow ?? 0;
    newPaid = order.paidAmount + cashIn;
  } else if (owedChange < 0 && (choice.refundNow || choice.toCredit) && order.paidAmount > netOwed) {
    if (choice.refundNow) cashOut = order.paidAmount - netOwed;
    else creditIn = order.paidAmount - netOwed;
    newPaid = netOwed;
  }
  return {
    newTotal,
    newDiscount,
    newPaid,
    paymentStatus: statusOf(netOwed, newPaid),
    cashIn,
    cashOut,
    creditIn,
    owedChange,
  };
}

/**
 * How much of a customer's credit can pay an order: at most their balance and
 * at most what the order still owes (`remaining`).
 */
export function creditUsable(balance: number, remaining: number): number {
  return Math.max(0, Math.min(balance, remaining));
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
