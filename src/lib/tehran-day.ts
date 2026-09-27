/**
 * Calendar days as Pooyan lives them: in Tehran.
 *
 * The server runs in UTC (Vercel), and a date picked in a form is the Tehran
 * midnight it was picked on (1 Mehr is 2026-09-22T20:30Z), so a day boundary
 * taken on the server's own clock is 3.5 hours off: rows picked for the first
 * day of a period fell before it, and sales made between midnight and 03:30
 * counted as the day before. Iran has kept +03:30 all year since it dropped
 * daylight saving time in 2022, before any row of this ERP.
 */
const TEHRAN_OFFSET_MS = (3 * 60 + 30) * 60 * 1000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The Tehran calendar day (YYYY-MM-DD) a moment falls on. */
export function tehranDay(date: Date): string {
  return new Date(date.getTime() + TEHRAN_OFFSET_MS).toISOString().slice(0, 10);
}

/** The first moment of a Tehran calendar day (YYYY-MM-DD). */
export function tehranDayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000+03:30`);
}

/** The last moment of a Tehran calendar day (YYYY-MM-DD). */
export function tehranDayEnd(day: string): Date {
  return new Date(`${day}T23:59:59.999+03:30`);
}

/** True for a bare calendar day, YYYY-MM-DD. */
export function isDay(value: string): boolean {
  return DAY.test(value);
}

/** The day `days` after (or before, when negative) a calendar day. */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
