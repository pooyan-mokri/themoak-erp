/**
 * An amount written out in Persian words, for the line under a money field
 * («دوازده میلیون و چهارصد هزار تومان»), and the Persian name of a currency.
 * Pure, so the forms and the tests share it.
 */

const ONES = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
const TEENS = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const TENS = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const HUNDREDS = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
const SCALES = ['', 'هزار', 'میلیون', 'میلیارد', 'تریلیون'];

const CURRENCY_NAMES: Record<string, string> = {
  TOMAN: 'تومان',
  USD: 'دلار',
  EUR: 'یورو',
  CNY: 'یوآن',
};

/** «تومان», «دلار»… or the code itself for a currency with no Persian name here. */
export function currencyName(code: string | null | undefined): string {
  if (!code) return 'تومان';
  return CURRENCY_NAMES[code] ?? code;
}

/** 1–999 in words. */
function belowThousand(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) parts.push(HUNDREDS[hundreds]);
  if (rest >= 10 && rest < 20) parts.push(TEENS[rest - 10]);
  else {
    if (rest >= 20) parts.push(TENS[Math.floor(rest / 10)]);
    if (rest % 10) parts.push(ONES[rest % 10]);
  }
  return parts.join(' و ');
}

/** A whole number in Persian words: 1,500 → «هزار و پانصد». */
export function integerInWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'صفر';
  const groups: string[] = [];
  for (let scale = 0; n > 0; scale++) {
    const group = n % 1000;
    n = Math.floor(n / 1000);
    if (!group) continue;
    if (scale >= SCALES.length) return Math.abs(value).toLocaleString('fa-IR');
    // «هزار», not «یک هزار»; but «یک میلیون».
    const words = scale === 1 && group === 1 ? '' : belowThousand(group);
    groups.unshift([words, SCALES[scale]].filter(Boolean).join(' '));
  }
  return groups.join(' و ');
}

/**
 * The amount in words, with its currency when one is given; '' for an empty or zero amount.
 * Up to two decimals are read as tenths or hundredths («دوازده ممیز پنج دهم دلار»).
 */
export function amountInWords(value: number | string | null | undefined, currency?: string | null): string {
  const n = typeof value === 'string' ? Number(value) : value ?? 0;
  if (!Number.isFinite(n) || n === 0) return '';
  const fraction = Math.abs(n).toFixed(2).split('.')[1].replace(/0+$/, '');
  const decimals = fraction
    ? ` ممیز ${integerInWords(Number(fraction))} ${fraction.length === 1 ? 'دهم' : 'صدم'}`
    : '';
  return `${n < 0 ? 'منفی ' : ''}${integerInWords(Math.trunc(n))}${decimals}${currency ? ` ${currencyName(currency)}` : ''}`;
}
