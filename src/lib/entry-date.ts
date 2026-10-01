import { tehranDayStart } from '@/lib/tehran-day';

/**
 * The date a person (or the website) gives a sale, a payment or any other
 * money entry. It must be a date that can be: from 1 Farvardin 1404
 * (2025-03-21, before TheMoak's first record) to a year after today. A Jalali
 * date typed into a Gregorian field lands in the year 1404 AD, and a
 * Gregorian one read as Jalali in 2647; both are refused. (The old WooCommerce
 * sync stored 16 orders in 1404 AD this way.) Plain functions, no server
 * imports.
 */
export const EARLIEST_ENTRY_DAY = '2025-03-21';
const A_YEAR_MS = 366 * 86_400_000;

/** Why `date` cannot be the date of `what` («فروش», «پرداخت», …), or null when it can. */
export function entryDateProblem(date: Date, what: string, now: Date = new Date()): string | null {
  if (Number.isNaN(date.getTime())) return `تاریخ ${what} نامعتبر است.`;
  if (date < tehranDayStart(EARLIEST_ENTRY_DAY) || date.getTime() > now.getTime() + A_YEAR_MS) {
    return `تاریخ ${what} ممکن نیست؛ باید از ۱ فروردین ۱۴۰۴ تا یک سال بعد از امروز باشد.`;
  }
  return null;
}

export type EntryDate = { ok: true; date: Date } | { ok: false; error: string };

/** A form's date for `what`: the one given, or `fallback` when none was; or why it cannot be used. */
export function readEntryDate(value: unknown, what: string, fallback: Date = new Date()): EntryDate {
  if (value === undefined || value === null || value === '') return { ok: true, date: fallback };
  const date = typeof value === 'string' || typeof value === 'number' || value instanceof Date ? new Date(value) : new Date(NaN);
  const error = entryDateProblem(date, what);
  return error ? { ok: false, error } : { ok: true, date };
}
