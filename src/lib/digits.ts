/**
 * Numbers typed or formatted in Persian. A Persian keyboard types ۰–۹ (and
 * some Arabic-Indic ٠–٩), and Intl's fa-IR output uses them too; Number and
 * parseInt read neither (parseInt('۷') is NaN). Pure, so forms and actions
 * share it.
 */
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';

/**
 * The same text with Latin digits: ۱۴۰۵ → 1405. The Arabic decimal separator
 * (٫) becomes a point and the Arabic thousands separator (٬) is dropped, so
 * «۳۰٬۰۰۰٬۰۰۰» reads 30000000. Anything that is not a string is returned as is.
 */
export function toLatinDigits<T>(value: T): T {
  if (typeof value !== 'string') return value;
  return value
    .replace(/[۰-۹]/g, (d) => String(PERSIAN.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/٬/g, '') as T;
}
