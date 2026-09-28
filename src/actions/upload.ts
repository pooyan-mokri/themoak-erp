'use server';

import { unlink } from 'fs/promises';
import { join } from 'path';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/access';
import { INVALID_RECEIPT_MESSAGE, RECEIPT_EXTENSIONS, RECEIPT_MAX_BYTES, isReceiptRef } from '@/lib/receipt-ref';
import { STORAGE_MISSING_MESSAGE, deleteReceiptFile, sniffReceiptType, storeReceipt } from '@/lib/receipt-storage';
import { PRODUCT_IMAGE_STORAGE_MISSING, deleteProductImageFile, storeProductImage } from '@/lib/product-image-storage';
import { productImageName } from '@/lib/product-image';

// Who records money records its receipt: finance staff for any row, sales staff
// for order payments (src/lib/receipt-ref.ts decides which row takes it).
const RECEIPT_UPLOADERS = ['finance.manage', 'sales.manage'] as const;

/** Stores a receipt photo or PDF and returns its reference, for a form to save on its row. */
export async function uploadReceipt(formData: FormData) {
  const denied = await checkPermission(RECEIPT_UPLOADERS);
  if (denied) return denied;
  const file = formData.get('file');
  if (!(file instanceof Blob) || file.size === 0) {
    return { success: false, error: 'فایلی انتخاب نشده است.' };
  }
  if (file.size > RECEIPT_MAX_BYTES) {
    return { success: false, error: 'حجم فایل نباید بیشتر از ۴ مگابایت باشد.' };
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  // The bytes decide the type, not the name or what the browser claimed.
  const type = sniffReceiptType(bytes);
  if (!type) {
    return { success: false, error: 'فقط عکس (JPG، PNG، WEBP) یا فایل PDF قابل آپلود است.' };
  }
  try {
    return { success: true, url: await storeReceipt(bytes, type), type };
  } catch (error: any) {
    console.error('[Upload] receipt:', error);
    const message =
      error?.message === STORAGE_MISSING_MESSAGE
        ? STORAGE_MISSING_MESSAGE
        : `آپلود رسید به سرور FTP انجام نشد: ${error?.message ?? 'خطای نامشخص'}`;
    return { success: false, error: message };
  }
}

/** Discards a receipt uploaded in a form but not saved; a receipt on a row stays. */
export async function deleteReceipt(ref: string) {
  const denied = await checkPermission(RECEIPT_UPLOADERS);
  if (denied) return denied;
  if (!isReceiptRef(ref)) return { success: false, error: INVALID_RECEIPT_MESSAGE };
  if (await prisma.transaction.findFirst({ where: { receiptUrl: ref }, select: { id: true } })) {
    return { success: false, error: 'این رسید به یک تراکنش ثبت‌شده وصل است و حذف نمی‌شود.' };
  }
  try {
    await deleteReceiptFile(ref);
    return { success: true };
  } catch (error) {
    console.error('[Upload] delete receipt:', error);
    return { success: false, error: 'حذف فایل انجام نشد.' };
  }
}

export async function uploadProductImage(formData: FormData) {
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
  const file = formData.get('file');

  if (!(file instanceof Blob) || file.size === 0) {
    return { success: false, error: 'فایلی انتخاب نشده است.' };
  }

  // Validate file size (10MB for product images)
  if (file.size > 10 * 1024 * 1024) {
    return {
      success: false,
      error: 'حجم عکس نباید بیشتر از ۱۰ مگابایت باشد.',
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // The bytes decide the type and the extension: the name and the type the
  // browser sends are the caller's to choose, and a name like
  // "x.png/../../y.html" wrote outside the folder, or an .html page into it.
  const type = sniffReceiptType(buffer);
  if (!type || type === 'application/pdf') {
    return {
      success: false,
      error: 'فقط عکس JPG، PNG یا WEBP قابل آپلود است.',
    };
  }

  try {
    // On the FTP server, like receipts: public/ cannot be written on Vercel.
    const url = await storeProductImage(buffer, RECEIPT_EXTENSIONS[type] as 'jpg' | 'png' | 'webp');
    return { success: true, url };
  } catch (error: any) {
    console.error('Upload error:', error);
    const message =
      error?.message === PRODUCT_IMAGE_STORAGE_MISSING
        ? PRODUCT_IMAGE_STORAGE_MISSING
        : `آپلود عکس به سرور FTP انجام نشد: ${error?.message ?? 'خطای نامشخص'}`;
    return { success: false, error: message };
  }
}

export async function deleteProductImage(url: string) {
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
  try {
    const stored = productImageName(url);
    if (stored) {
      await deleteProductImageFile(stored);
      return { success: true };
    }

    // A photo uploaded before, in public/: /uploads/products/<uuid>.<ext> (the name's extension).
    const filename = /^\/uploads\/products\/([0-9a-f-]{36}\.[A-Za-z0-9]{1,5})$/i.exec(url)?.[1];
    if (!filename) return { success: false, error: 'نشانی عکس نامعتبر است.' };

    const filepath = join(
      process.cwd(),
      'public',
      'uploads',
      'products',
      filename
    );

    await unlink(filepath);

    return { success: true };
  } catch (error) {
    console.error('Delete error:', error);
    return { success: false, error: 'حذف عکس انجام نشد.' };
  }
}
