/**
 * The reports overview's arithmetic, with no server or React imports: the window a
 * range covers, the same-shaped window before it, and the sums drawn from each sale.
 * Days and hours are Tehran's (Iran keeps UTC+03:30 all year), wherever this runs.
 */

export type ReportRange = '4w' | '12w' | 'ytd';

export const REPORT_RANGES: { id: ReportRange; label: string }[] = [
  { id: '4w', label: '۴ هفته' },
  { id: '12w', label: '۱۲ هفته' },
  { id: 'ytd', label: 'سال جاری' },
];

export function parseRange(value: string | undefined): ReportRange | null {
  return REPORT_RANGES.some((range) => range.id === value) ? (value as ReportRange) : null;
}

export const DAY = 86_400_000;
const TEHRAN_OFFSET = 3.5 * 3_600_000;

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0, useGrouping: false }).format(n);

/** Midnight in Tehran of the day holding t. */
export function startOfTehranDay(t: number) {
  return Math.floor((t + TEHRAN_OFFSET) / DAY) * DAY - TEHRAN_OFFSET;
}

const persianParts = new Intl.DateTimeFormat('en-US-u-ca-persian', {
  timeZone: 'Asia/Tehran',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

/** The Jalali year, month and day of t in Tehran. */
export function jalaliDate(t: number) {
  const parts = Object.fromEntries(persianParts.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

/** Midnight in Tehran of 1 Farvardin of the Jalali year holding t (months 1–6 have 31 days, 7–11 have 30). */
export function startOfJalaliYear(t: number) {
  const { month, day } = jalaliDate(t);
  const dayOfYear = (month <= 6 ? (month - 1) * 31 : 186 + (month - 7) * 30) + day - 1;
  return startOfTehranDay(t) - dayOfYear * DAY;
}

const shortDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'Asia/Tehran', month: '2-digit', day: '2-digit' });
const fullDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: 'Asia/Tehran',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const jalaliShort = (t: number) => shortDate.format(new Date(t));
export const jalaliFull = (t: number) => fullDate.format(new Date(t));

export type ReportWindow = {
  range: ReportRange;
  /** This period: [start, end]. */
  start: number;
  end: number;
  /** The period it is compared with, the same length and shape: [prevStart, prevEnd]. */
  prevStart: number;
  prevEnd: number;
  /** One point of the trend covers this many days. */
  bucketDays: 1 | 7;
  label: string;
  prevLabel: string;
};

/**
 * The last 4 or 12 weeks up to now (today included), or this Jalali year so far.
 * The comparison ends at the same moment of its own period, so a half-finished
 * today is never compared with a whole day.
 */
export function reportWindow(range: ReportRange, now: number = Date.now()): ReportWindow {
  if (range === 'ytd') {
    const start = startOfJalaliYear(now);
    const prevStart = startOfJalaliYear(start - DAY);
    return {
      range,
      start,
      end: now,
      prevStart,
      prevEnd: prevStart + (now - start),
      bucketDays: 7,
      label: `از ابتدای سال ${fa(jalaliDate(now).year)}`,
      prevLabel: `همین بازه در سال ${fa(jalaliDate(prevStart).year)}`,
    };
  }
  const days = range === '4w' ? 28 : 84;
  const start = startOfTehranDay(now) - (days - 1) * DAY;
  return {
    range,
    start,
    end: now,
    prevStart: start - days * DAY,
    prevEnd: now - days * DAY,
    bucketDays: range === '4w' ? 1 : 7,
    label: range === '4w' ? '۴ هفتهٔ اخیر' : '۱۲ هفتهٔ اخیر',
    prevLabel: range === '4w' ? '۴ هفتهٔ پیش از آن' : '۱۲ هفتهٔ پیش از آن',
  };
}

export type Sale = { at: Date | string | number; amount: number; channel: 'site' | 'woo' | 'shop' };

export type TrendPoint = {
  /** Where this point starts, and where the compared point starts. */
  at: number;
  prevAt: number;
  revenue: number;
  orders: number;
  prevRevenue: number;
  prevOrders: number;
};

export const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

export const CHANNEL_LABELS: Record<Sale['channel'], string> = {
  site: 'سایت',
  woo: 'ووکامرس (سایت قبلی)',
  shop: 'فروشگاه',
};

export type SalesSummary = {
  trend: TrendPoint[];
  totals: { revenue: number; orders: number; prevRevenue: number; prevOrders: number };
  /** Orders and revenue per Tehran weekday (Saturday first) and hour. */
  heat: { orders: number[][]; revenue: number[][] };
  channels: { id: Sale['channel']; revenue: number; orders: number; prevRevenue: number; prevOrders: number }[];
};

const time = (at: Sale['at']) => (at instanceof Date ? at.getTime() : typeof at === 'number' ? at : Date.parse(at));

/** Everything the overview shows, from this period's sales and the compared period's. */
export function summarizeSales(window: ReportWindow, current: Sale[], previous: Sale[]): SalesSummary {
  const size = window.bucketDays * DAY;
  const count = Math.max(1, Math.ceil((window.end - window.start + 1) / size));
  const trend: TrendPoint[] = Array.from({ length: count }, (_, i) => ({
    at: window.start + i * size,
    prevAt: window.prevStart + i * size,
    revenue: 0,
    orders: 0,
    prevRevenue: 0,
    prevOrders: 0,
  }));
  const heat = {
    orders: WEEKDAYS.map(() => Array<number>(24).fill(0)),
    revenue: WEEKDAYS.map(() => Array<number>(24).fill(0)),
  };
  const channels = new Map<Sale['channel'], SalesSummary['channels'][number]>();
  const channel = (id: Sale['channel']) => {
    if (!channels.has(id)) channels.set(id, { id, revenue: 0, orders: 0, prevRevenue: 0, prevOrders: 0 });
    return channels.get(id)!;
  };
  const totals = { revenue: 0, orders: 0, prevRevenue: 0, prevOrders: 0 };

  for (const sale of current) {
    const t = time(sale.at);
    if (t < window.start || t > window.end) continue;
    const point = trend[Math.min(count - 1, Math.floor((t - window.start) / size))];
    point.revenue += sale.amount;
    point.orders += 1;
    totals.revenue += sale.amount;
    totals.orders += 1;
    const local = new Date(t + TEHRAN_OFFSET);
    const weekday = (local.getUTCDay() + 1) % 7; // Saturday first
    heat.orders[weekday][local.getUTCHours()] += 1;
    heat.revenue[weekday][local.getUTCHours()] += sale.amount;
    const c = channel(sale.channel);
    c.revenue += sale.amount;
    c.orders += 1;
  }
  for (const sale of previous) {
    const t = time(sale.at);
    if (t < window.prevStart || t > window.prevEnd) continue;
    const point = trend[Math.min(count - 1, Math.floor((t - window.prevStart) / size))];
    point.prevRevenue += sale.amount;
    point.prevOrders += 1;
    totals.prevRevenue += sale.amount;
    totals.prevOrders += 1;
    const c = channel(sale.channel);
    c.prevRevenue += sale.amount;
    c.prevOrders += 1;
  }

  const order: Sale['channel'][] = ['site', 'woo', 'shop'];
  return {
    trend,
    totals,
    heat,
    channels: order.filter((id) => channels.has(id)).map((id) => channels.get(id)!),
  };
}

/** Group daily totals (keyed YYYY-MM-DD, as getSalesOverTime returns them) into days or weeks from a start day. */
export function bucketDaily(
  daily: { period: string; revenue: number; orders: number }[],
  start: number,
  end: number,
): { at: number; revenue: number; orders: number; bucketDays: 1 | 7 }[] {
  const first = startOfTehranDay(start);
  const days = Math.ceil((end - first + 1) / DAY);
  const bucketDays: 1 | 7 = days <= 35 ? 1 : 7;
  const size = bucketDays * DAY;
  const count = Math.max(1, Math.ceil(days / bucketDays));
  const points = Array.from({ length: count }, (_, i) => ({ at: first + i * size, revenue: 0, orders: 0, bucketDays }));
  for (const day of daily) {
    // The key is the UTC calendar day; its noon falls inside the same Tehran day.
    const t = Date.parse(`${day.period}T12:00:00Z`);
    if (Number.isNaN(t)) continue;
    const index = Math.min(count - 1, Math.max(0, Math.floor((startOfTehranDay(t) - first) / size)));
    points[index].revenue += day.revenue;
    points[index].orders += day.orders;
  }
  return points;
}
