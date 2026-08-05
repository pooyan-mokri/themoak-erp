/**
 * Accounting policy: purchase capitalization cutover.
 *
 * BEFORE the cutover the books are kept on the old cash basis: buying goods was
 * recorded as an operating expense ('Purchase Payment' / 'Purchase Arrival Cost')
 * and sales carried no cost of goods sold. Those periods are LEFT EXACTLY AS THEY
 * WERE — reports for past periods must not change, and shareholder profit
 * distributions computed from them must not shift.
 *
 * FROM the cutover onwards the standard (accrual) model applies:
 *   - buying goods is NOT an expense; cash decreases and inventory (an asset)
 *     increases at landed cost — see receivePurchaseOrderItems,
 *   - the expense is recognised as COGS when the goods are SOLD — see src/lib/cogs.ts.
 *
 * Both halves are tied to this one date so the books can never be half-migrated:
 * a purchase is dropped from the P&L only if a sale of those goods would book COGS.
 *
 * Cutover: 1 Shahrivar 1405 = 2026-08-23, local Tehran midnight (UTC+03:30).
 */
export const ACCOUNTING_CUTOVER = new Date('2026-08-22T20:30:00.000Z');

/** Jalali label for the cutover, for user-facing copy. */
export const ACCOUNTING_CUTOVER_JALALI = '۱ شهریور ۱۴۰۵';

/**
 * Cash-side categories written by the purchasing module. The rows still exist
 * (Account.balance must stay correct — the money really left), but from the
 * cutover on they are capitalized into inventory rather than expensed.
 * Exact strings written by recordPurchasePayment / recordPurchasePartialPayment
 * / recordArrival in src/actions/supplier-workflow.ts.
 */
export const CAPITALIZED_PURCHASE_CATEGORIES = [
  'Purchase Payment',
  'Purchase Arrival Cost',
] as const;

/**
 * Prisma `where` fragment that keeps a transaction in the P&L unless it is a
 * post-cutover purchase.
 *
 * Written as an explicit OR rather than `NOT`/`notIn` because Transaction.category
 * is nullable, and Prisma's NOT/notIn compile to SQL that silently DROPS
 * NULL-category rows (legacy and WooCommerce-imported transactions have none).
 *
 * Spread it into a where object:
 *   where: { ...EXCLUDE_CAPITALIZED_PURCHASES, type: 'EXPENSE' }
 *
 * Do NOT spread it into a where that already declares its own top-level `OR`
 * (the second key would overwrite the first) — merge manually with AND instead.
 */
export const EXCLUDE_CAPITALIZED_PURCHASES = {
  OR: [
    { category: null },
    { category: { notIn: [...CAPITALIZED_PURCHASE_CATEGORIES] } },
    // Pre-cutover purchases stay expensed, so history is untouched.
    { date: { lt: ACCOUNTING_CUTOVER } },
  ],
};

/** In-memory equivalent of the filter above, for already-fetched rows. */
export function countsAsExpense(tx: { category?: string | null; date: Date | string }): boolean {
  if (!tx.category) return true;
  if (!(CAPITALIZED_PURCHASE_CATEGORIES as readonly string[]).includes(tx.category)) return true;
  return new Date(tx.date) < ACCOUNTING_CUTOVER;
}

/** True when a sale on this date must book COGS under the new policy. */
export function shouldBookCogs(date: Date | string): boolean {
  return new Date(date) >= ACCOUNTING_CUTOVER;
}
