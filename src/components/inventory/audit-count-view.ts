/**
 * View helpers for the inventory count screens (انبارگردانی): rounds, list filters, product search and typed numbers.
 * Pure TS with no React, so it is tested directly.
 */
import { normalizeScanCode } from '@/lib/audit-scan';

export type Round = 1 | 2 | 3;

export const ROUNDS: Round[] = [1, 2, 3];

export const ROUND_LABELS: Record<Round, string> = { 1: 'شمارش اول', 2: 'شمارش دوم', 3: 'شمارش سوم' };

/** The item fields the count screens read. A count is null or undefined while not counted. */
export type AuditCountItem = {
  productId: string;
  systemQuantity: number;
  countedQuantity1?: number | null;
  countedQuantity2?: number | null;
  countedQuantity3?: number | null;
  finalQuantity?: number | null;
  product: { name: string; sku: string; webId?: string | null; barcode?: string | null };
};

/** ?round= in the URL. Anything but 2 or 3 is round 1. */
export function parseRound(value: string | null | undefined): Round {
  return value === '2' ? 2 : value === '3' ? 3 : 1;
}

export function countOf(item: AuditCountItem, round: Round): number | null {
  const count = round === 1 ? item.countedQuantity1 : round === 2 ? item.countedQuantity2 : item.countedQuantity3;
  return count ?? null;
}

/** The count of the latest round that has one, as «نهایی کردن همه از آخرین شمارش» takes it. */
export function lastCount(item: AuditCountItem): number | null {
  return countOf(item, 3) ?? countOf(item, 2) ?? countOf(item, 1);
}

export type ItemFilter = 'all' | 'uncounted' | 'notFinal' | 'mismatch' | 'final';

export const ITEM_FILTERS: Array<{ value: ItemFilter; label: string }> = [
  { value: 'all', label: 'همه' },
  { value: 'uncounted', label: 'شمارش‌نشده با موجودی سیستمی' },
  { value: 'notFinal', label: 'شمارش‌شده، نهایی‌نشده' },
  { value: 'mismatch', label: 'شمارش ≠ سیستم' },
  { value: 'final', label: 'نهایی‌شده' },
];

/** 'uncounted' and 'notFinal' are exactly the items that block issuing adjustments. */
export function matchesFilter(item: AuditCountItem, filter: ItemFilter): boolean {
  const last = lastCount(item);
  const final = item.finalQuantity ?? null;
  switch (filter) {
    case 'uncounted':
      return item.systemQuantity !== 0 && last === null && final === null;
    case 'notFinal':
      return last !== null && final === null;
    case 'mismatch':
      return last !== null && last !== item.systemQuantity;
    case 'final':
      return final !== null;
    default:
      return true;
  }
}

// Arabic yeh (U+064A) and alef maksura (U+0649) match Persian yeh (U+06CC); Arabic kaf (U+0643) matches Persian kaf (U+06A9).
const ARABIC_YEH = new RegExp(`[${String.fromCharCode(0x064a, 0x0649)}]`, 'g');
const ARABIC_KAF = new RegExp(String.fromCharCode(0x0643), 'g');
const PERSIAN_YEH = String.fromCharCode(0x06cc);
const PERSIAN_KAF = String.fromCharCode(0x06a9);

/** Text as search compares it: the scan normalising (digits, invisible marks, trim, case) plus Persian yeh and kaf. */
export function foldSearchText(text: string): string {
  return normalizeScanCode(text).replace(ARABIC_YEH, PERSIAN_YEH).replace(ARABIC_KAF, PERSIAN_KAF);
}

/** True when the folded query is part of the product's name, SKU, webId or barcode. An empty query matches all. */
export function matchesSearch(item: AuditCountItem, foldedQuery: string): boolean {
  if (!foldedQuery) return true;
  const { name, sku, webId, barcode } = item.product;
  return [name, sku, webId, barcode].some((value) => !!value && foldSearchText(value).includes(foldedQuery));
}

/** A whole number typed with Latin, Persian or Arabic digits; null for anything else (empty, 1.5, -1, letters). */
export function parseWholeNumber(raw: string): number | null {
  const text = normalizeScanCode(raw);
  return /^\d{1,9}$/.test(text) ? Number(text) : null;
}

/** Key of a count the server confirmed to this page. */
export function confirmedKey(auditId: string, round: Round, productId: string): string {
  return `${auditId}:${round}:${productId}`;
}

/**
 * A round's count as this page knows it. A save the server confirmed after the page data was loaded wins, because the
 * page data is not refreshed after scans. A newer number saved by another user then comes back as a conflict.
 */
export function knownCount(
  confirmed: ReadonlyMap<string, number | null>,
  auditId: string,
  round: Round,
  item: AuditCountItem
): number | null {
  const key = confirmedKey(auditId, round, item.productId);
  return confirmed.has(key) ? (confirmed.get(key) ?? null) : countOf(item, round);
}

/** productId → known count of the round: the starting totals of a save queue. */
export function roundTotals(
  auditId: string,
  round: Round,
  items: AuditCountItem[],
  confirmed: ReadonlyMap<string, number | null>
): Map<string, number | null> {
  return new Map(items.map((item) => [item.productId, knownCount(confirmed, auditId, round, item)] as const));
}

/**
 * For page data loaded again, which holds every count saved before it: drops the counts this page confirmed, so
 * knownCount reads the page data. `keep` are the products this device has unsaved or in conflict in `round`; their
 * confirmed count stays the base of what is still to be sent.
 */
export function forgetConfirmedCounts(
  confirmed: Map<string, number | null>,
  auditId: string,
  round: Round,
  items: AuditCountItem[],
  keep: ReadonlySet<string>
): void {
  for (const item of items) {
    for (const r of ROUNDS) {
      if (r !== round || !keep.has(item.productId)) confirmed.delete(confirmedKey(auditId, r, item.productId));
    }
  }
}

export const RESOLVE_CONFLICTS_FIRST = 'ابتدا شمارش‌های ناسازگار را حل کنید.';

/** Why the count screen cannot leave its round now, or null. `pending` includes the conflicts, which never save. */
export function roundChangeBlock(pending: number, conflicts: number): string | null {
  if (conflicts > 0) return RESOLVE_CONFLICTS_FIRST;
  return pending > 0 ? 'اول صبر کنید همهٔ شمارش‌ها ذخیره شوند.' : null;
}
