/**
 * One rule for stock levels on every screen and report (Pooyan's decision): out of stock is 0 or less, a
 * negative row included (a website sale ahead of the shelf); low is 1 to 3; anything above is fine.
 * Plain data and functions, used by server actions and client components alike.
 */

export const LOW_STOCK_MAX = 3;

export type StockLevel = 'OUT' | 'LOW' | 'OK';

export function stockLevel(quantity: number): StockLevel {
  if (quantity <= 0) return 'OUT';
  return quantity <= LOW_STOCK_MAX ? 'LOW' : 'OK';
}
