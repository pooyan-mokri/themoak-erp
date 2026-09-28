/**
 * A percentage discount in whole toman: rounded to the nearest toman
 * (Pooyan's rule), half a toman up. 15% of 333,333 is 49,999.95, so 50,000.
 * Pure (no server imports), so the POS and the promotion code share it.
 */
export function percentDiscount(total: number, percent: number): number {
  return Math.round((total * percent) / 100);
}
