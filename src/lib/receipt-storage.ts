// Server-only helpers for src/actions/upload.ts and src/app/api/receipts, which check access first.
// Deliberately not a 'use server' file: that would make every export a public endpoint.
import { randomUUID } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { readSystemSetting } from '@/lib/system-settings';
import { deleteFromFTP, downloadFromFTP, uploadToFTP } from '@/lib/ftp';
import { RECEIPT_EXTENSIONS, isReceiptRef, type ReceiptContentType } from '@/lib/receipt-ref';

/**
 * Receipts live on the FTP server set in Settings. A machine without one
 * (development, tests) keeps them in .receipts/ next to the code, under the
 * same paths; a deployment without one refuses.
 */
const ftpConfigured = async () => Boolean(await readSystemSetting('ftp_credentials'));

export const STORAGE_MISSING_MESSAGE = 'سرور FTP رسیدها در تنظیمات وارد نشده است؛ به مدیر سیستم خبر دهید.';

const LOCAL_FOLDER = '/uploads/receipts';
const localPath = (ref: string) => join(process.cwd(), '.receipts', ref.slice('ftp:'.length));

function assertRef(ref: string) {
  if (!isReceiptRef(ref)) throw new Error(`not a receipt reference: ${ref}`);
}

/** The content type the bytes really are, whatever the browser claimed; null when not an allowed type. */
export function sniffReceiptType(bytes: Buffer): ReceiptContentType | null {
  const ascii = (start: number, end: number) => bytes.subarray(start, end).toString('latin1');
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

/** Stores the file and returns its reference for Transaction.receiptUrl. */
export async function storeReceipt(bytes: Buffer, contentType: ReceiptContentType): Promise<string> {
  const name = `${randomUUID()}.${RECEIPT_EXTENSIONS[contentType]}`;
  if (await ftpConfigured()) {
    const { url } = await uploadToFTP(bytes, name);
    // The folder comes from Settings; a path the viewer would refuse is useless.
    if (!isReceiptRef(url)) throw new Error(`پوشهٔ FTP در تنظیمات مسیر نامعتبری دارد: ${url}`);
    return url;
  }
  if (process.env.VERCEL) throw new Error(STORAGE_MISSING_MESSAGE);
  const ref = `ftp:${LOCAL_FOLDER}/${name}`;
  await mkdir(dirname(localPath(ref)), { recursive: true });
  await writeFile(localPath(ref), bytes);
  return ref;
}

/** The stored file, or null when there is none. */
export async function readReceipt(ref: string): Promise<Buffer | null> {
  assertRef(ref);
  if (await ftpConfigured()) return downloadFromFTP(ref);
  return readFile(localPath(ref)).catch(() => null);
}

export async function deleteReceiptFile(ref: string): Promise<void> {
  assertRef(ref);
  if (await ftpConfigured()) await deleteFromFTP(ref);
  else await unlink(localPath(ref)).catch(() => {});
}
