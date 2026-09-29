import { EXPENSE_CATEGORIES } from '@/components/accounting/entry-categories';

/**
 * Transaction categories as the actions and the forms store them, in Persian: the journal, the expense list and
 * the profit and loss show these names. A category typed in Persian (or unknown) is shown as stored.
 * Plain data (no 'use client'), used on both sides.
 */
const CATEGORY_LABELS: Record<string, string> = {
  Sales: 'فروش',
  Return: 'مرجوعی',
  Exchange: 'تعویض کالا',
  COGS: 'بهای تمام‌شده کالای فروش‌رفته',
  Salary: 'حقوق',
  Depreciation: 'استهلاک',
  'Purchase Payment': 'پرداخت خرید',
  'Purchase Arrival Cost': 'هزینه حمل و ورود خرید',
  'Marketing/Gift': 'هدیه بازاریابی',
  'Marketing - Gift': 'هدیه بازاریابی',
  'Loan Payment': 'بازپرداخت قرض',
  'Currency Exchange': 'معامله ارز',
  'Shareholder Deposit': 'واریز سرمایه سهامدار',
  'Shareholder Withdrawal': 'برداشت سرمایه سهامدار',
  'Shareholder Profit Withdrawal': 'برداشت سود سهامدار',
  'Employee Debt Payment': 'تسویه بدهی کارمند',
  CONSIGNMENT_COMMISSION: 'کمیسیون فروش امانی',
  // The expense form's own categories (Rent, Office, …), as the form names them.
  ...Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.value, c.label])),
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}
