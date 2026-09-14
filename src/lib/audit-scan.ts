/**
 * Scan lookup for the inventory count (انبارگردانی): turns what a barcode scanner typed into an audit item.
 *
 * Pure and client-side. The index is built from the audit page's items, so a scan is answered with no network
 * round trip. A code matches a product's barcode, SKU or webId after normalising.
 */

export type ScanItem = { productId: string; barcode?: string | null; sku: string; webId?: string | null };

/** Normalised code → the distinct products it points to. More than one product means the key is ambiguous. */
export type ScanIndex = Map<string, string[]>;

export type ScanResult =
  | { kind: 'match'; productId: string; code: string }
  | { kind: 'ambiguous'; productIds: string[]; code: string }
  | { kind: 'empty' }
  | { kind: 'unknown'; code: string; persianLayout: boolean };

// C0 and C1 control characters (CR, LF and tab included), zero-width and bidi marks, and the BOM.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

// The Arabic-script blocks without their digits: letters, harakat and Arabic punctuation.
const ARABIC_SCRIPT = /[\u0600-\u065F\u066A-\u06EF\u06FA-\u06FF\u0750-\u077F\u0870-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/;

export function normalizeScanCode(raw: string): string {
  return raw
    .replace(INVISIBLE, '')
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .trim()
    .toUpperCase();
}

/**
 * True when the text has Arabic-script characters other than digits. Codes never contain them, so they are a sign
 * that the scanner typed on a Persian keyboard layout.
 */
export function hasPersianLetters(raw: string): boolean {
  return ARABIC_SCRIPT.test(raw);
}

export function buildScanIndex(items: ScanItem[]): ScanIndex {
  const index: ScanIndex = new Map();
  const put = (key: string, productId: string) => {
    const ids = index.get(key);
    if (!ids) index.set(key, [productId]);
    else if (!ids.includes(productId)) ids.push(productId);
  };
  for (const item of items) {
    for (const value of [item.barcode, item.sku, item.webId]) {
      const key = normalizeScanCode(value ?? '');
      if (!key) continue;
      put(key, item.productId);
      // One printed UPC-A symbol reads as 12 digits or as EAN-13 with a leading 0, depending on the scanner.
      if (/^\d{12}$/.test(key)) put(`0${key}`, item.productId);
      else if (/^0\d{12}$/.test(key)) put(key.slice(1), item.productId);
    }
  }
  return index;
}

export function resolveScan(index: ScanIndex, raw: string): ScanResult {
  const code = normalizeScanCode(raw);
  if (!code) return { kind: 'empty' };
  const ids = index.get(code);
  if (!ids) return { kind: 'unknown', code, persianLayout: hasPersianLetters(raw) };
  return ids.length === 1
    ? { kind: 'match', productId: ids[0], code }
    : { kind: 'ambiguous', productIds: [...ids], code };
}
