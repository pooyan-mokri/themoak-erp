/**
 * Landed-cost (قیمت تمام‌شده) calculation — shared by the server (receiving goods)
 * and the UI (purchase-order detail), so the two can never drift apart.
 *
 * Additional costs (freight, commission, customs, clearance…) are allocated
 * PRO RATA ON VALUE, not on unit count: freight/duty/insurance scale with the
 * value of the goods, so a cheap high-count part must not absorb the same
 * amount as an expensive one.
 *
 *   poolInToman        = Σ order additionalCosts + Σ arrival additionalCosts   (in Toman; a cost with no Toman
 *                        snapshot, as the API records one in the supplier's currency, at the live rate)
 *   orderValueInToman  = Σ quantity_i × unitCostInToman_i
 *   perUnit_i          = poolInToman × unitCostInToman_i / orderValueInToman
 *   landedPerUnit_i    = unitCostInToman_i + perUnit_i
 *
 * The allocation is exact: Σ quantity_i × perUnit_i === poolInToman.
 *
 * Receiving costs each unit on the ORDERED quantities. An order closed short (closePurchaseOrderShort) is
 * re-spread on the RECEIVED quantities instead, so the whole pool lands on the units that came: 10 ordered,
 * 200,000 freight, 8 received gives 25,000 a unit (Pooyan's decision).
 */

/** Which quantities the pool is spread over. */
export type CostBasis = 'ordered' | 'received';

type Numeric = number | string | { toString(): string } | null | undefined;

export interface LandedCostItem {
  quantity: Numeric;
  /** Needed for the 'received' basis only. */
  receivedQuantity?: Numeric;
  unitCost: Numeric;
  currency?: string | null;
  /** Toman value snapshotted at order time; preferred over a live re-conversion. */
  unitCostInToman?: Numeric;
}

export interface LandedCostCost {
  /** Toman value snapshotted when the cost was recorded; preferred over a live re-conversion. */
  amountInToman?: Numeric;
  /** In `currency`: used, at the live rate, when there is no Toman snapshot. */
  amount?: Numeric;
  currency?: string | null;
}

export interface LandedCostOrder {
  items: LandedCostItem[];
  additionalCosts?: LandedCostCost[] | null;
  arrivalAdditionalCosts?: LandedCostCost[] | null;
  /** The order's Toman total, set when it was placed; none on an order recorded in the supplier's currency. */
  totalAmountInToman?: Numeric;
}

/** Coerce Prisma.Decimal | string | number | null into a finite number. */
function num(value: Numeric): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value as any);
  return Number.isFinite(n) ? n : 0;
}

/** True when a snapshot value is actually present (0 is a legitimate value). */
function isPresent(value: Numeric): boolean {
  return value !== null && value !== undefined && Number.isFinite(Number(value as any));
}

/**
 * Unit cost in Toman, preferring the rate snapshotted when the order was placed
 * so later FX moves never retroactively change an existing order's cost.
 */
export function unitCostInToman(
  item: LandedCostItem,
  getExchangeRate: (currency: string) => number
): number {
  if (isPresent(item.unitCostInToman)) return num(item.unitCostInToman);
  return num(item.unitCost) * getExchangeRate(item.currency || 'TOMAN');
}

/**
 * One additional cost in Toman: its snapshot, or, recorded in the supplier's currency with none (an order made
 * through the API), its amount at the live rate, as unitCostInToman prices such a line.
 */
export function costInToman(cost: LandedCostCost | null | undefined, getExchangeRate: (currency: string) => number): number {
  if (!cost) return 0;
  if (isPresent(cost.amountInToman)) return num(cost.amountInToman);
  return num(cost.amount) * getExchangeRate(cost.currency || 'TOMAN');
}

/** Total additional-cost pool in Toman: order-level costs + arrival costs. */
export function additionalCostPool(order: LandedCostOrder, getExchangeRate: (currency: string) => number): number {
  const orderCosts = (order.additionalCosts ?? []).reduce((s, c) => s + costInToman(c, getExchangeRate), 0);
  const arrivalCosts = (order.arrivalAdditionalCosts ?? []).reduce((s, c) => s + costInToman(c, getExchangeRate), 0);
  return orderCosts + arrivalCosts;
}

const quantityOn = (item: LandedCostItem, basis: CostBasis) => num(basis === 'received' ? item.receivedQuantity : item.quantity);

/** Total ordered (or received) value in Toman — the basis for value-weighted allocation. */
export function orderValueInToman(
  order: LandedCostOrder,
  getExchangeRate: (currency: string) => number,
  basis: CostBasis = 'ordered'
): number {
  return order.items.reduce(
    (sum, item) => sum + quantityOn(item, basis) * unitCostInToman(item, getExchangeRate),
    0
  );
}

/**
 * Share of the additional-cost pool carried by ONE unit of `item`.
 * Falls back to a per-unit split only when the order has no value at all
 * (e.g. every line is priced at zero), where value-weighting is undefined.
 */
export function additionalCostPerUnit(
  item: LandedCostItem,
  order: LandedCostOrder,
  getExchangeRate: (currency: string) => number,
  basis: CostBasis = 'ordered'
): number {
  const pool = additionalCostPool(order, getExchangeRate);
  if (pool === 0) return 0;

  const totalValue = orderValueInToman(order, getExchangeRate, basis);
  if (totalValue > 0) {
    return (pool * unitCostInToman(item, getExchangeRate)) / totalValue;
  }

  const totalQuantity = order.items.reduce((s, i) => s + quantityOn(i, basis), 0);
  return totalQuantity > 0 ? pool / totalQuantity : 0;
}

/** Landed cost of one unit: its own cost plus its share of the additional costs. */
export function landedCostPerUnit(
  item: LandedCostItem,
  order: LandedCostOrder,
  getExchangeRate: (currency: string) => number,
  basis: CostBasis = 'ordered'
): number {
  return unitCostInToman(item, getExchangeRate) + additionalCostPerUnit(item, order, getExchangeRate, basis);
}

/**
 * What the units that came are worth to the supplier when an order is closed short: each received unit at the
 * order's Toman price, plus all of the order's own additional costs, which the close re-spreads onto them.
 * Arrival costs are left out: they were paid on arrival, not through the order's payments.
 */
export function receivedValueInToman(
  order: LandedCostOrder,
  getExchangeRate: (currency: string) => number
): number {
  const goods = order.items.reduce(
    (sum, item) => sum + num(item.receivedQuantity) * unitCostInToman(item, getExchangeRate),
    0
  );
  return goods + (order.additionalCosts ?? []).reduce((s, c) => s + costInToman(c, getExchangeRate), 0);
}

/**
 * An order closed short (closePurchaseOrderShort): received, with a line that came in below what was ordered.
 * An order received the old way records no received quantities and is not one.
 */
export function isClosedShort(order: { status?: string | null; items: Array<{ quantity: Numeric; receivedQuantity?: Numeric }> }): boolean {
  return (
    order.status === 'RECEIVED' &&
    order.items.some((item) => num(item.receivedQuantity) > 0) &&
    order.items.some((item) => num(item.receivedQuantity) < num(item.quantity))
  );
}

/**
 * What the supplier is owed for an order in all, in Toman, before payments: its Toman total, or for an order
 * closed short the value of the units that came (receivedValueInToman; the rest was never delivered). An order
 * with no Toman total (recorded in the supplier's currency) is priced as the payment code prices it: its lines
 * and order costs at the live rate.
 */
export function owedTotalInToman(
  order: LandedCostOrder & { status?: string | null },
  getExchangeRate: (currency: string) => number
): number {
  if (isClosedShort(order)) return receivedValueInToman(order, getExchangeRate);
  if (num(order.totalAmountInToman) > 0) return num(order.totalAmountInToman);
  return (
    orderValueInToman(order, getExchangeRate) +
    (order.additionalCosts ?? []).reduce((s, c) => s + costInToman(c, getExchangeRate), 0)
  );
}

/**
 * Closing short: what was paid beyond the value of the units that came (receivedValueInToman) becomes the
 * supplier's credit. 0 when the payments do not cover even that (the rest stays owed), or differ by under a
 * toman (the payments' rounding).
 */
export function shortShipmentCredit(
  order: LandedCostOrder,
  paidInToman: number,
  getExchangeRate: (currency: string) => number
): number {
  const credit = paidInToman - receivedValueInToman(order, getExchangeRate);
  return credit >= 1 ? credit : 0;
}
