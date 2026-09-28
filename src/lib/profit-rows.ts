/**
 * Which money rows are trading, for profit and loss.
 *
 * Some INCOME and EXPENSE rows move money without earning or spending any: the
 * owners' capital, a loan to an employee and its repayment, the two legs of a
 * currency exchange, a transfer between the company's own accounts, and the
 * repayment of what an employee paid out of pocket (the expense itself was
 * booked when the employee paid it). Profit leaves them out; they stay in the
 * journal. How each is recorded:
 *
 *  - capital: 'Shareholder Deposit' (INCOME), 'Shareholder Withdrawal' (EXPENSE),
 *    and a profit paid out, 'Shareholder Profit Withdrawal' (EXPENSE) —
 *    src/actions/shareholder.ts, shareholder-profit.ts
 *  - loans: the payout 'قرض به کارمند' (EXPENSE) and each repayment
 *    'Loan Payment' (INCOME) — src/actions/loan.ts
 *  - currency exchange: both legs 'Currency Exchange', linked by
 *    exchangeGroupId (none on legs recorded before it existed) —
 *    src/actions/currency-exchange.ts
 *  - transfers: in the app both legs are TRANSFER rows 'انتقال وجه'; through
 *    the API the incoming leg is an INCOME row 'انتقال داخلی'; both carry
 *    transferGroupId (none on legs recorded before it existed) —
 *    src/actions/accounting.ts, src/app/api/erp/route.ts
 *  - an employee's out-of-pocket expense repaid: 'تسویه بدهی کارمند'
 *    (EXPENSE), formerly 'Employee Debt Payment' (INCOME) —
 *    src/actions/accounting.ts
 */
export const NON_OPERATING_CATEGORIES: readonly string[] = [
  'Shareholder Deposit',
  'Shareholder Withdrawal',
  'Shareholder Profit Withdrawal',
  'قرض به کارمند',
  'Loan Payment',
  'Currency Exchange',
  'انتقال وجه',
  'انتقال داخلی',
  'تسویه بدهی کارمند',
  'Employee Debt Payment',
];

/**
 * Money spent on stock, which is inventory until it is sold and then cost of
 * goods sold (a COGS row): a supplier payment 'Purchase Payment'
 * (src/actions/supplier-workflow.ts) and the arrival costs paid when an order
 * arrives, 'Purchase Arrival Cost'. Receiving rolls the order's additional and
 * arrival costs into the product's cost price (src/lib/landed-cost.ts), so
 * they reach the P&L through COGS.
 */
export const CAPITALISED_CATEGORIES: readonly string[] = [
  'Purchase Payment',
  'Purchase Arrival Cost',
];

/** Cost of goods sold, at product cost: consignment sales and POS sales book it. */
export const COGS_CATEGORY = 'COGS';

export type ProfitRow = {
  type: string;
  category?: string | null;
  exchangeGroupId?: string | null;
  transferGroupId?: string | null;
  amountInToman?: unknown;
  amount?: unknown;
  currency?: string | null;
};

/**
 * A row's value in Toman for profit: its Toman equivalent, or for a Toman row
 * written before that column was filled, its amount (never a foreign amount).
 */
export function profitAmount(row: ProfitRow): number {
  const toman = Number(row.amountInToman ?? 0);
  if (toman) return toman;
  return (row.currency ?? 'TOMAN') === 'TOMAN' ? Number(row.amount ?? 0) || 0 : 0;
}

/** True for a row that is not revenue or expense (see above). */
export function isNonOperating(row: ProfitRow): boolean {
  return (
    row.type === 'TRANSFER' ||
    !!row.exchangeGroupId ||
    !!row.transferGroupId ||
    NON_OPERATING_CATEGORIES.includes(row.category ?? '')
  );
}

/** True for money turned into stock or a fixed asset rather than spent (see above). */
export function isCapitalised(row: ProfitRow): boolean {
  return CAPITALISED_CATEGORIES.includes(row.category ?? '');
}

/**
 * Where a row goes in profit and loss: revenue, cost of goods sold or an
 * operating expense; null for a row that is none of them.
 * P&L = revenue − cost of goods sold − operating expenses.
 */
export function profitLine(row: ProfitRow): 'revenue' | 'cogs' | 'expense' | null {
  if (row.type !== 'INCOME' && row.type !== 'EXPENSE') return null;
  if (isNonOperating(row) || isCapitalised(row)) return null;
  if (row.type === 'INCOME') return 'revenue';
  return row.category === COGS_CATEGORY ? 'cogs' : 'expense';
}
