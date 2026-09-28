import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { formatJalaliDate, formatJalaliDateLong, formatJalaliDateShort, formatJalaliDateTime } from '@/lib/date-utils';

// The server runs in UTC (Vercel), the browser in Tehran: a date shown in the runtime's own zone was the
// server's hour, the day before after 20:30, and a hydration error. The Jalali helpers show Tehran's time
// whatever zone they run in.

const zone = process.env.TZ;
after(() => {
  process.env.TZ = zone;
});

test('the Jalali date helpers show Tehran\'s day and hour in any runtime time zone', () => {
  // 21:10 UTC on 22 Sep 2026 is 00:40 on 1 Mehr 1405 in Tehran.
  const lateEvening = new Date('2026-09-22T21:10:00.000Z');
  // A day picked in Tehran is stored at its Tehran midnight, 20:30 UTC the day before.
  const pickedDay = new Date('2026-09-22T20:30:00.000Z');
  for (const tz of ['UTC', 'Asia/Tehran', 'America/New_York', 'Asia/Tokyo']) {
    process.env.TZ = tz;
    assert.deepEqual(
      [formatJalaliDateTime(lateEvening), formatJalaliDate(pickedDay), formatJalaliDateLong(pickedDay), formatJalaliDateShort(pickedDay)],
      ['۱۴۰۵/۰۷/۰۱ ۰۰:۴۰', '۱۴۰۵/۰۷/۰۱', '۱۴۰۵ مهر ۰۱', '۰۱ مهر'],
      tz,
    );
  }
});
