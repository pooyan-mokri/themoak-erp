// Server-only helpers for src/actions/upload.ts and src/app/api/product-images, which check access first.
// Deliberately not a 'use server' file: that would make every export a public endpoint.
import { randomUUID } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { readSystemSetting } from '@/lib/system-settings';
import { deleteFromFTP, downloadFromFTP, uploadToFTP } from '@/lib/ftp';
import { PRODUCT_IMAGE_ROUTE, isProductImageName } from '@/lib/product-image';

/**
 * Product photos go to the FTP server set in Settings, like receipts: a
 * Vercel function cannot write to public/. A machine without FTP settings
 * (development, tests) keeps them in .product-images/ next to the code; a
 * deployment without them refuses.
 */
export const PRODUCT_IMAGE_FOLDER = '/product-images';

export const PRODUCT_IMAGE_STORAGE_MISSING = 'سرور FTP در تنظیمات وارد نشده است؛ عکس کالا ذخیره نمی‌شود. به مدیر سیستم خبر دهید.';

export const PRODUCT_IMAGE_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;
type Extension = keyof typeof PRODUCT_IMAGE_TYPES;

const ftpConfigured = async () => Boolean(await readSystemSetting('ftp_credentials'));
const localPath = (name: string) => join(process.cwd(), '.product-images', name);

function assertName(name: string) {
  if (!isProductImageName(name)) throw new Error(`not a product image name: ${name}`);
}

/** Stores the photo and returns the address Product.image keeps. */
export async function storeProductImage(bytes: Buffer, extension: Extension): Promise<string> {
  const name = `${randomUUID()}.${extension}`;
  if (await ftpConfigured()) {
    await uploadToFTP(bytes, name, PRODUCT_IMAGE_FOLDER);
  } else {
    if (process.env.VERCEL) throw new Error(PRODUCT_IMAGE_STORAGE_MISSING);
    await mkdir(join(process.cwd(), '.product-images'), { recursive: true });
    await writeFile(localPath(name), bytes);
  }
  return `${PRODUCT_IMAGE_ROUTE}${name}`;
}

/** The stored photo, or null when there is none. */
export async function readProductImage(name: string): Promise<Buffer | null> {
  assertName(name);
  if (await ftpConfigured()) return downloadFromFTP(`${PRODUCT_IMAGE_FOLDER}/${name}`);
  return readFile(localPath(name)).catch(() => null);
}

export async function deleteProductImageFile(name: string): Promise<void> {
  assertName(name);
  if (await ftpConfigured()) await deleteFromFTP(`${PRODUCT_IMAGE_FOLDER}/${name}`);
  else await unlink(localPath(name)).catch(() => {});
}
