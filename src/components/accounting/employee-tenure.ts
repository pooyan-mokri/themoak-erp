import moment from 'moment-jalaali';

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);

/** Whole months between a hire date and today (never negative). */
export function tenureMonths(hireDate: Date | string, today: Date = new Date()): number {
  return Math.max(0, moment(today).diff(moment(hireDate), 'months'));
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
  const start = moment(today).startOf('day');
  return employees
    .flatMap((employee) => {
      if (!employee.hireDate) return [];
      const hire = moment(employee.hireDate);
      let next = hire.clone().jYear(start.jYear()).startOf('day');
      if (next.isBefore(start)) next = hire.clone().jYear(start.jYear() + 1).startOf('day');
      const years = next.jYear() - hire.jYear();
      if (years < 1) return [];
      return [{ id: employee.id, name: employee.name, years, date: next.toDate(), days: next.diff(start, 'days') }];
    })
    .sort((a, b) => a.days - b.days);
}
