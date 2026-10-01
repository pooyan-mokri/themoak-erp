/**
 * The categories the money forms offer. Plain data (no 'use client'): the forms
 * list them, and the form pages use them to find the recent entries each form made.
 */

import { RENT_DEPOSIT_CATEGORY, RENT_DEPOSIT_RETURN_CATEGORY } from '@/lib/profit-rows';

/** Stored as the English value; shown with the Persian label. */
export const EXPENSE_CATEGORIES = [
  { value: 'Rent', label: 'اجاره' },
  { value: 'Salary', label: 'حقوق' },
  { value: 'Marketing', label: 'مارکتینگ' },
  { value: 'Office', label: 'اداری' },
  { value: 'Transport', label: 'حمل و نقل' },
  // A fixed asset bought is an asset, not an expense (src/lib/profit-rows.ts).
  { value: 'خرید تجهیزات', label: 'خرید تجهیزات (دارایی ثابت)' },
  // A rent deposit is an asset that comes back, not an expense (src/lib/profit-rows.ts).
  { value: RENT_DEPOSIT_CATEGORY, label: 'ودیعه اجاره (دارایی)' },
  { value: 'Other', label: 'سایر' },
];

export const DEPOSIT_CATEGORIES = [
  'واریز نقدی',
  'واریز بانکی',
  'برگشت وجه',
  'دریافت از مشتری',
  'سرمایه‌گذاری',
  'وام دریافتی',
  // A rent deposit coming back: not revenue (src/lib/profit-rows.ts).
  RENT_DEPOSIT_RETURN_CATEGORY,
  'سایر',
];

/** What recordDeposit stores when no category was chosen. */
export const DEPOSIT_DEFAULT_CATEGORY = 'واریز';

export const PAYMENT_CATEGORIES = [
  'پرداخت اجاره',
  'پرداخت قبض',
  'خرید تجهیزات',
  RENT_DEPOSIT_CATEGORY,
  'هزینه حمل‌ونقل',
  'پرداخت به تامین‌کننده',
  'پرداخت به پیمانکار',
  'سایر هزینه‌ها',
];
