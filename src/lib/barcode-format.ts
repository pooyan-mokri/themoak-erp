/**
 * Barcode numbers: GS1 check digits, and the symbology that prints a stored code unchanged.
 *
 * Pure, so client components can use it. A label must encode exactly Product.barcode, or the count scanner
 * (src/lib/audit-scan.ts) cannot find the product; nothing here alters a code.
 */

export type BarcodeFormat = 'EAN13' | 'UPC' | 'CODE128';

/** GS1 check digit (EAN-13, UPC-A): weights 3 and 1 alternate, starting with 3 on the rightmost data digit. */
function gs1CheckDigit(data: string, length: number): number {
  if (data.length !== length || !/^\d+$/.test(data)) throw new Error(`Expected ${length} digits, got "${data}"`);
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += Number(data[i]) * ((data.length - i) % 2 === 1 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

export function ean13CheckDigit(first12: string): number {
  return gs1CheckDigit(first12, 12);
}

export function upcACheckDigit(first11: string): number {
  return gs1CheckDigit(first11, 11);
}

/** Exactly 13 digits with a correct check digit. */
export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** Exactly 12 digits with a correct check digit. */
export function isValidUpcA(code: string): boolean {
  return /^\d{12}$/.test(code) && upcACheckDigit(code.slice(0, 11)) === Number(code[11]);
}

/**
 * A valid EAN-13 or UPC-A: printed unchanged, it scans back as itself. A valid 12-digit code printed correctly
 * before, so its labels stay in use; only hyphenated or malformed codes need replacing.
 */
export function isStandardBarcode(code: string | null | undefined): boolean {
  return !!code && (isValidEan13(code) || isValidUpcA(code));
}

/** EAN13 or UPC for a valid code of that kind; anything else prints as Code 128, which encodes any text as-is. */
export function barcodeFormatFor(code: string): BarcodeFormat {
  if (isValidEan13(code)) return 'EAN13';
  if (isValidUpcA(code)) return 'UPC';
  return 'CODE128';
}

/**
 * A random EAN-13 in GS1's in-store range: 29, ten random digits, the check digit. Prefixes 20-29 are kept for use
 * inside a company, so no manufacturer's barcode starts with 29.
 */
export function randomInStoreEan13(random: () => number = Math.random): string {
  let first12 = '29';
  for (let i = 0; i < 10; i++) first12 += Math.floor(random() * 10);
  return first12 + ean13CheckDigit(first12);
}
