import moment from 'moment-jalaali';
import { formatJalaliDate } from '@/lib/date-utils';

/**
 * The periods the profit and loss page switches between, in the Jalali
 * calendar: a month, a season (quarter) or a year, and the one before it.
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

/** The period of this kind that contains `at`. */
export function periodAt(kind: PeriodKind, at: Date): Period {
  const m = moment(at);
  let start: moment.Moment;
  let end: moment.Moment;
  let label: string;
  if (kind === 'month') {
    start = moment(m).startOf('jMonth');
    end = moment(m).endOf('jMonth');
    label = `${JALALI_MONTHS[start.jMonth()]} ${year(start.jYear())}`;
  } else if (kind === 'quarter') {
    const season = Math.floor(m.jMonth() / 3);
    start = moment(m).startOf('jMonth').jMonth(season * 3);
    end = moment(start).add(2, 'jMonth').endOf('jMonth');
    label = `${SEASONS[season]} ${year(start.jYear())}`;
  } else {
    start = moment(m).startOf('jYear');
    end = moment(m).endOf('jYear');
    label = `سال ${year(start.jYear())}`;
  }
  return { kind, from: start.toDate(), to: end.toDate(), label };
}

/** The period just before: the previous month, season or year, or an equally long range for a custom one. */
export function previousPeriod(period: Period): Period {
  if (period.kind === 'custom') {
    const length = period.to.getTime() - period.from.getTime();
    const to = new Date(period.from.getTime() - 1);
    const from = new Date(to.getTime() - length);
    return { kind: 'custom', from, to, label: `${day(from)} تا ${day(to)}` };
  }
  return periodAt(period.kind, moment(period.from).subtract(1, 'day').toDate());
}

/** A date inside the period after this one. */
export function nextPeriodStart(period: Period): Date {
  return moment(period.to).add(1, 'day').startOf('day').toDate();
}

/** The `count` Jalali months ending with the one that contains `end`, oldest first. */
export function trailingMonths(end: Date, count = 12): Period[] {
  const last = moment(end).startOf('jMonth');
  return Array.from({ length: count }, (_, i) => periodAt('month', moment(last).subtract(count - 1 - i, 'jMonth').toDate()));
}

/**
 * The date a link carries for a period: its first day, as YYYY-MM-DD in Latin
 * digits (moment's Persian locale would write Persian digits, which no URL parses).
 */
export const atParam = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const valid = (d: Date) => !Number.isNaN(d.getTime());

/**
 * The period a URL asks for: ?period=month|quarter|year&at=YYYY-MM-DD, or the
 * older ?from=&to= custom range. The current Jalali month otherwise.
 */
export function resolvePeriod(params: { period?: string; at?: string; from?: string; to?: string }, today = new Date()): Period {
  if (params.from || params.to) {
    const from = params.from ? new Date(params.from) : null;
    const to = params.to ? new Date(params.to) : null;
    if (from && to && valid(from) && valid(to) && from <= to) {
      const end = moment(to).endOf('day').toDate();
      return { kind: 'custom', from, to: end, label: `${day(from)} تا ${day(end)}` };
    }
  }
  const kind = PERIOD_KINDS.some((k) => k.id === params.period) ? (params.period as PeriodKind) : 'month';
  const at = params.at ? new Date(params.at) : today;
  return periodAt(kind, valid(at) ? at : today);
}
