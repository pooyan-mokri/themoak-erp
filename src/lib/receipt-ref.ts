import { can } from '@/lib/permissions';

/**
 * A receipt file on the FTP server set in Settings (src/lib/receipt-storage.ts).
 * Transaction.receiptUrl holds its path as `ftp:<folder>/<uuid>.<ext>`, the form
 * receipts have always been stored in. It is never a link: the browser reads the
 * file through /api/receipts, which checks who is asking.
 * Pure (no server imports), so client components share it.
 */

// No `..` or empty segment can pass: each folder name starts with a letter, digit, _ or -.
const REF =
  /^ftp:(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpe?g|png|webp|pdf)$/i;

/** What a receipt may be, by content type, with the extension it is stored under. */
export const RECEIPT_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
} as const;

export type ReceiptContentType = keyof typeof RECEIPT_EXTENSIONS;

/** Below the 4.5 MB a Vercel function accepts; photos are shrunk in the browser first. */
export const RECEIPT_MAX_BYTES = 4 * 1024 * 1024;

export const INVALID_RECEIPT_MESSAGE = 'فایل رسید نامعتبر است؛ دوباره آپلود کنید.';

export function isReceiptRef(value: unknown): value is string {
  return typeof value === 'string' && REF.test(value);
}

/**
 * An optional receipt from a form field or an action argument: undefined when
 * none was given, null when the value is not a stored receipt.
 */
export function readReceiptRef(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  return isReceiptRef(value) ? value : null;
}

/** Where the browser opens a receipt; null for a value that is not a stored receipt. */
export function receiptViewUrl(ref: string): string | null {
  return isReceiptRef(ref) ? `/api/receipts?ref=${encodeURIComponent(ref)}` : null;
}

export function isPdfReceipt(ref: string): boolean {
  return /\.pdf$/i.test(ref);
}

type ReceiptRow = { type: string; orderId?: string | null };

/**
 * Who may attach a receipt to a money row: finance staff to any row, and sales
 * staff to money received for an order (they record those payments).
 */
export function mayAttachReceipt(role: string | null | undefined, row: ReceiptRow): boolean {
  return can(role, 'finance.manage') || (!!row.orderId && row.type === 'INCOME' && can(role, 'sales.manage'));
}

/**
 * Who may open a receipt: whoever may see the row it is attached to. A file on
 * no row yet was just uploaded in a form, and its uploader previews it.
 */
export function mayViewReceipt(role: string | null | undefined, row: ReceiptRow | null): boolean {
  if (!row) return can(role, 'finance.manage') || can(role, 'sales.manage');
  return can(role, 'finance.view') || (!!row.orderId && row.type === 'INCOME' && can(role, 'sales.view'));
}
