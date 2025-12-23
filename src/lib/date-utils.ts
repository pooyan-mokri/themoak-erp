import moment from 'moment-jalaali';

// Configure moment-jalaali
moment.loadPersian({ dialect: 'persian-modern', usePersianDigits: true });

/**
 * Format a date to Persian Jalali format
 * @param date - Date object, string, or null
 * @param format - Format string (default: 'jYYYY/jMM/jDD')
 * @returns Formatted Persian date string
 */
export function formatJalaliDate(
  date: Date | string | null | undefined,
  format: string = 'jYYYY/jMM/jDD'
): string {
  if (!date) return '-';
  return moment(date).format(format);
}

/**
 * Format a date to Persian Jalali with time
 * @param date - Date object, string, or null
 * @returns Formatted Persian date and time string
 */
export function formatJalaliDateTime(
  date: Date | string | null | undefined
): string {
  if (!date) return '-';
  return moment(date).format('jYYYY/jMM/jDD HH:mm');
}

/**
 * Format a date to a more readable Persian format
 * @param date - Date object, string, or null
 * @returns Formatted Persian date in long format (e.g., "۱۴۰۳ آذر ۱۱")
 */
export function formatJalaliDateLong(
  date: Date | string | null | undefined
): string {
  if (!date) return '-';
  return moment(date).format('jYYYY jMMMM jDD');
}

/**
 * Format a date to a short readable format
 * @param date - Date object, string, or null
 * @returns Formatted Persian date (e.g., "۱۱ آذر")
 */
export function formatJalaliDateShort(
  date: Date | string | null | undefined
): string {
  if (!date) return '-';
  return moment(date).format('jDD jMMMM');
}

/**
 * Get relative time in Persian (e.g., "۲ روز پیش")
 * @param date - Date object, string, or null
 * @returns Relative time string in Persian
 */
export function getJalaliRelativeTime(
  date: Date | string | null | undefined
): string {
  if (!date) return '-';
  return moment(date).fromNow();
}

/**
 * Parse a Jalali date string to JavaScript Date
 * @param jalaliDateString - Date string in Jalali format (e.g., "1403/09/11")
 * @param format - Format of the input string
 * @returns JavaScript Date object
 */
export function parseJalaliDate(
  jalaliDateString: string,
  format: string = 'jYYYY/jMM/jDD'
): Date {
  return moment(jalaliDateString, format).toDate();
}

/**
 * Get current Jalali date
 * @returns Current date in Jalali format
 */
export function getCurrentJalaliDate(): string {
  return moment().format('jYYYY/jMM/jDD');
}

/**
 * Get current Jalali date and time
 * @returns Current date and time in Jalali format
 */
export function getCurrentJalaliDateTime(): string {
  return moment().format('jYYYY/jMM/jDD HH:mm:ss');
}

/**
 * Check if a date is in the past
 * @param date - Date to check
 * @returns true if date is in the past
 */
export function isJalaliDatePast(date: Date | string): boolean {
  return moment(date).isBefore(moment());
}

/**
 * Check if a date is in the future
 * @param date - Date to check
 * @returns true if date is in the future
 */
export function isJalaliDateFuture(date: Date | string): boolean {
  return moment(date).isAfter(moment());
}

/**
 * Get difference between two dates in days
 * @param date1 - First date
 * @param date2 - Second date
 * @returns Difference in days
 */
export function getJalaliDateDifference(
  date1: Date | string,
  date2: Date | string
): number {
  return moment(date1).diff(moment(date2), 'days');
}

/**
 * Add days to a date
 * @param date - Base date
 * @param days - Number of days to add
 * @returns New date
 */
export function addJalaliDays(date: Date | string, days: number): Date {
  return moment(date).add(days, 'days').toDate();
}

/**
 * Subtract days from a date
 * @param date - Base date
 * @param days - Number of days to subtract
 * @returns New date
 */
export function subtractJalaliDays(date: Date | string, days: number): Date {
  return moment(date).subtract(days, 'days').toDate();
}

/**
 * Get start of Jalali month
 * @param date - Date in the month
 * @returns Start of the Jalali month
 */
export function getStartOfJalaliMonth(date?: Date | string): Date {
  return moment(date).startOf('jMonth').toDate();
}

/**
 * Get end of Jalali month
 * @param date - Date in the month
 * @returns End of the Jalali month
 */
export function getEndOfJalaliMonth(date?: Date | string): Date {
  return moment(date).endOf('jMonth').toDate();
}

/**
 * Get start of Jalali year
 * @param date - Date in the year
 * @returns Start of the Jalali year
 */
export function getStartOfJalaliYear(date?: Date | string): Date {
  return moment(date).startOf('jYear').toDate();
}

/**
 * Get end of Jalali year
 * @param date - Date in the year
 * @returns End of the Jalali year
 */
export function getEndOfJalaliYear(date?: Date | string): Date {
  return moment(date).endOf('jYear').toDate();
}

/**
 * Format date for form inputs (ISO format for compatibility)
 * @param date - Date to format
 * @returns Date in YYYY-MM-DD format for input fields
 */
export function formatDateForInput(date: Date | string | null | undefined): string {
  if (!date) return '';
  return moment(date).format('YYYY-MM-DD');
}

/**
 * Get Jalali month name
 * @param monthNumber - Month number (1-12)
 * @returns Jalali month name in Persian
 */
export function getJalaliMonthName(monthNumber: number): string {
  const months = [
    'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
  ];
  return months[monthNumber - 1] || '';
}

/**
 * Get Jalali day of week name
 * @param date - Date to get day name for
 * @returns Persian day name
 */
export function getJalaliDayName(date: Date | string): string {
  const dayNames = [
    'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه', 'شنبه'
  ];
  const dayIndex = moment(date).day();
  return dayNames[dayIndex];
}

/**
 * Convert numbers to Persian digits
 * @param num - Number or string to convert
 * @returns String with Persian digits
 */
export function toPersianDigits(num: number | string): string {
  const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(num).replace(/\d/g, (digit) => persianDigits[parseInt(digit)]);
}

/**
 * Format currency with Persian digits
 * @param amount - Amount to format
 * @param currency - Currency name (default: 'تومان')
 * @returns Formatted currency string
 */
export function formatPersianCurrency(
  amount: number | string,
  currency: string = 'تومان'
): string {
  const formatted = new Intl.NumberFormat('fa-IR').format(Number(amount));
  return `${formatted} ${currency}`;
}
