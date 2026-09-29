import moment from 'moment-jalaali';
import { tehranDay, tehranDayStart } from '@/lib/tehran-day';

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);

/**
 * A moment's Tehran calendar day as a UTC moment: calendar arithmetic only. A date picked in Tehran is stored at
 * its Tehran midnight (20:30 UTC the day before), so the server (UTC) and the browser (Tehran) must both read it
 * as Tehran's day, or they disagree by a day and the page fails to hydrate.
 */
const day = (date: Date | string) => moment.utc(tehranDay(new Date(date)), 'YYYY-MM-DD');

/** Whole months between a hire date and today (never negative). */
export function tenureMonths(hireDate: Date | string, today: Date = new Date()): number {
  return Math.max(0, day(today).diff(day(hireDate), 'months'));
}

/** «۲ سال و ۳ ماه», «۵ ماه», «کمتر از یک ماه». */
export function tenureLabel(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return rest === 0 ? 'کمتر از یک ماه' : `${fa(rest)} ماه`;
  return rest === 0 ? `${fa(years)} سال` : `${fa(years)} سال و ${fa(rest)} ماه`;
}

export type Anniversary = { id: string; name: string; years: number; date: Date; days: number };

/**
 * Each employee's next work anniversary on the Jalali calendar (the hire date's month
 * and day; 30 Esfand falls on the 29th in a common year), soonest first.
 */
export function upcomingAnniversaries(
  employees: { id: string; name: string; hireDate?: Date | string | null }[],
  today: Date = new Date(),
): Anniversary[] {
  const start = day(today);
  return employees
    .flatMap((employee) => {
      if (!employee.hireDate) return [];
      const hire = day(employee.hireDate);
      let next = hire.clone().jYear(start.jYear());
      if (next.isBefore(start)) next = hire.clone().jYear(start.jYear() + 1);
      const years = next.jYear() - hire.jYear();
      if (years < 1) return [];
      const date = tehranDayStart(next.clone().locale('en').format('YYYY-MM-DD'));
      return [{ id: employee.id, name: employee.name, years, date, days: next.diff(start, 'days') }];
    })
    .sort((a, b) => a.days - b.days);
}
