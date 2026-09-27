import moment from 'moment-jalaali';
import { toPersianDigits } from '@/lib/date-utils';

export const MONTH_NAMES = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

/** «مهر ۱۴۰۵» */
export const periodLabel = (year: number, month: number) => `${MONTH_NAMES[month - 1] ?? month} ${toPersianDigits(year)}`;

export const periodKey = (year: number, month: number) => `${year}-${month}`;

/** Today's Jalali year and month (1–12). */
export function currentPeriod(today: Date = new Date()): { year: number; month: number } {
  const now = moment(today);
  return { year: now.jYear(), month: now.jMonth() + 1 };
}

/** A payslip's status as a colour and a word (design system §12). */
export function payrollStatus(status: string): { label: string; tone: string } {
  if (status === 'PAID') return { label: 'پرداخت شده', tone: 'bg-success-soft text-success' };
  if (status === 'PARTIAL') return { label: 'پرداخت جزئی', tone: 'bg-brand-soft text-brand' };
  if (status === 'PENDING') return { label: 'در انتظار پرداخت', tone: 'bg-warning-soft text-warning' };
  return { label: status, tone: 'bg-secondary text-muted-foreground' };
}

/** A month's payslips together: paid when every one is, partly paid once money has gone out. */
export function runStatus(slips: { status: string; paidAmount: number }[]) {
  if (slips.length > 0 && slips.every((p) => p.status === 'PAID')) return payrollStatus('PAID');
  if (slips.some((p) => p.paidAmount > 0)) return payrollStatus('PARTIAL');
  return payrollStatus('PENDING');
}
