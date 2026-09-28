import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toLatinDigits } from '@/lib/digits';
import { jalaliYearMonth } from '@/lib/tehran-day';

test('Persian and Arabic-Indic digits and separators read as Latin', () => {
  assert.equal(toLatinDigits('۱۲۳۴۵۶۷۸۹۰'), '1234567890');
  assert.equal(toLatinDigits('١٢٣٤٥٦٧٨٩٠'), '1234567890');
  assert.equal(toLatinDigits('۳۰٬۰۰۰٬۰۰۰'), '30000000');
  assert.equal(toLatinDigits('۱۲٫۵'), '12.5');
  assert.equal(toLatinDigits('1405'), '1405');
  assert.equal(toLatinDigits(null), null);
  assert.equal(Number(toLatinDigits('۷')), 7);
});

test('the Jalali year and month are read in Tehran, with Latin digits', () => {
  assert.deepEqual(jalaliYearMonth(new Date('2026-09-22T20:29:59Z')), { year: 1405, month: 6 }, '31 Shahrivar 23:59 in Tehran');
  assert.deepEqual(jalaliYearMonth(new Date('2026-09-22T20:30:00Z')), { year: 1405, month: 7 }, '1 Mehr 00:00 in Tehran');
  assert.deepEqual(jalaliYearMonth(new Date('2026-03-20T20:30:00Z')), { year: 1405, month: 1 }, 'Nowruz 1405');
  assert.deepEqual(jalaliYearMonth(new Date('2026-03-20T20:29:00Z')), { year: 1404, month: 12 });
});

test('the new-payslip form opens on the current Jalali month, not on month 1 of 1403', () => {
  const code = readFileSync(join(process.cwd(), 'src/components/accounting/payroll-form.tsx'), 'utf8');
  assert.match(code, /jalaliYearMonth\(new Date\(\)\)/);
  assert.doesNotMatch(code, /parseInt\(/, 'parseInt cannot read the ۱۴۰۵ that fa-IR formats');
  assert.doesNotMatch(code, /Intl\.DateTimeFormat\('fa-IR'/);
});
