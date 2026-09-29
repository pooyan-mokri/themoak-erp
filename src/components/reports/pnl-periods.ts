import moment from 'moment-jalaali';
import { formatJalaliDate } from '@/lib/date-utils';
import { addDays, isDay, tehranDay, tehranDayEnd, tehranDayStart } from '@/lib/tehran-day';

/**
 * The periods the profit and loss page switches between, in the Jalali
 * calendar: a month, a season (quarter) or a year, and the one before it.
 * Days are Tehran's (src/lib/tehran-day.ts): a period runs from the Tehran
 * midnight of its first day to the end of its last, whatever zone the server
 * runs in (UTC on Vercel).
 */

export type PeriodKind = 'month' | 'quarter' | 'year';

export type Period = {
  kind: PeriodKind | 'custom';
  from: Date;
  to: Date;
  label: string;
};

export const PERIOD_KINDS: Array<{ id: PeriodKind; label: string }> = [
  { id: 'month', label: 'ماهانه' },
  { id: 'quarter', label: 'فصلی' },
  { id: 'year', label: 'سالانه' },
];

export const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const SEASONS = ['بهار', 'تابستان', 'پاییز', 'زمستان'];

const year = (n: number) => new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(n);
const day = (d: Date) => formatJalaliDate(d);

/** The Tehran calendar day of `at`, as a UTC moment: calendar arithmetic only, no zone. */
const tehranMoment = (at: Date) => moment.utc(tehranDay(at), 'YYYY-MM-DD');
const dayOf = (m: moment.Moment) => m.clone().locale('en').format('YYYY-MM-DD');

/** The period of this kind that contains `at` (in Tehran). */
export function periodAt(kind: PeriodKind, at: Date): Period {
  const m = tehranMoment(at);
  let start: moment.Moment;
  let end: moment.Moment;
  let label: string;
  if (kind === 'month') {
    start = m.clone().startOf('jMonth');
    end = m.clone().endOf('jMonth');
    label = `${JALALI_MONTHS[start.jMonth()]} ${year(start.jYear())}`;
  } else if (kind === 'quarter') {
    const season = Math.floor(m.jMonth() / 3);
    start = m.clone().startOf('jMonth').jMonth(season * 3);
    end = start.clone().add(2, 'jMonth').endOf('jMonth');
    label = `${SEASONS[season]} ${year(start.jYear())}`;
  } else {
    start = m.clone().startOf('jYear');
    end = m.clone().endOf('jYear');
    label = `سال ${year(start.jYear())}`;
  }
  return { kind, from: tehranDayStart(dayOf(start)), to: tehranDayEnd(dayOf(end)), label };
}

/** The period just before: the previous month, season or year, or an equally long range for a custom one. */
export function previousPeriod(period: Period): Period {
  if (period.kind === 'custom') {
    const length = period.to.getTime() - period.from.getTime();
    const to = new Date(period.from.getTime() - 1);
    const from = new Date(to.getTime() - length);
    return { kind: 'custom', from, to, label: `${day(from)} تا ${day(to)}` };
  }
  return periodAt(period.kind, new Date(period.from.getTime() - 1));
}

/** The first moment of the period after this one. */
export function nextPeriodStart(period: Period): Date {
  return tehranDayStart(addDays(tehranDay(period.to), 1));
}

/** The `count` Jalali months ending with the one that contains `end`, oldest first. */
export function trailingMonths(end: Date, count = 12): Period[] {
  const last = tehranMoment(end).startOf('jMonth');
  return Array.from({ length: count }, (_, i) =>
    periodAt('month', tehranDayStart(dayOf(last.clone().subtract(count - 1 - i, 'jMonth')))),
  );
}

/**
 * The date a link carries for a period: its Tehran day, as YYYY-MM-DD in Latin
 * digits (moment's Persian locale would write Persian digits, which no URL parses).
 */
export const atParam = (date: Date) => tehranDay(date);

const valid = (d: Date) => !Number.isNaN(d.getTime());

/**
 * The period a URL asks for: ?period=month|quarter|year&at=YYYY-MM-DD, or the
 * older ?from=&to= custom range. The current Jalali month otherwise.
 */
export function resolvePeriod(params: { period?: string; at?: string; from?: string; to?: string }, today = new Date()): Period {
  if (params.from && params.to && isDay(params.from) && isDay(params.to) && params.from <= params.to) {
    const from = tehranDayStart(params.from);
    const end = tehranDayEnd(params.to);
    return { kind: 'custom', from, to: end, label: `${day(from)} تا ${day(end)}` };
  }
  const kind = PERIOD_KINDS.some((k) => k.id === params.period) ? (params.period as PeriodKind) : 'month';
  const at = params.at && isDay(params.at) ? tehranDayStart(params.at) : today;
  return periodAt(kind, valid(at) ? at : today);
}
