import { effectiveQuantity } from '@/lib/return-math';

/**
 * What a product's sale lines still sold (Pooyan's decision), for the product page and product analytics:
 * units net of returns and exchanges, and revenue net of the order's discount too. The discount is on the
 * whole order, so each line carries the part of it that its still-sold value is of the order's.
 * The unit price is the line's own (a consignment partner's commission is a selling cost, not a discount).
 */

export type SaleLine = {
  quantity: number;
  price: unknown;
  returns?: Array<{ quantity: number }>;
  exchanges?: Array<{ quantity: number }>;
};

/** `order.items` are all the order's lines, each with its returns and exchanges. */
export function netLineSale(
  line: SaleLine,
  order: { discount?: unknown; items: SaleLine[] },
): { units: number; revenue: number } {
  const units = effectiveQuantity(line);
  const gross = units * Number(line.price);
  const orderGross = order.items.reduce((sum, item) => sum + effectiveQuantity(item) * Number(item.price), 0);
  if (orderGross <= 0) return { units, revenue: gross };
  const discount = Math.min(Math.max(0, Number(order.discount ?? 0)), orderGross);
  return { units, revenue: gross - (discount * gross) / orderGross };
}

/** The include that loads what netLineSale needs for a product's order lines. */
export const SALE_LINE_INCLUDE = {
  returns: { select: { quantity: true } },
  exchanges: { select: { quantity: true } },
} as const;
