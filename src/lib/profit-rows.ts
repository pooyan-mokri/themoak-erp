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

export type ProfitRow = {
  type: string;
  category?: string | null;
  exchangeGroupId?: string | null;
  transferGroupId?: string | null;
};

/** True for a row that is not revenue or expense (see above). */
export function isNonOperating(row: ProfitRow): boolean {
  return (
    row.type === 'TRANSFER' ||
    !!row.exchangeGroupId ||
    !!row.transferGroupId ||
    NON_OPERATING_CATEGORIES.includes(row.category ?? '')
  );
}
