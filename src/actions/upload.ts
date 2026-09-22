'use server';

import { writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/access';
import { INVALID_RECEIPT_MESSAGE, RECEIPT_MAX_BYTES, isReceiptRef } from '@/lib/receipt-ref';
import { STORAGE_MISSING_MESSAGE, deleteReceiptFile, sniffReceiptType, storeReceipt } from '@/lib/receipt-storage';

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
  try {
    const file = formData.get('file') as File;

    if (!file) {
      return { success: false, error: 'No file provided' };
    }

    // Validate file type - only images
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      return {
        success: false,
        error: 'Invalid file type. Only JPG, PNG and WEBP allowed.',
      };
    }

    // Validate file size (10MB for product images)
    if (file.size > 10 * 1024 * 1024) {
      return {
        success: false,
        error: 'File size too large. Max 10MB allowed.',
      };
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Create uploads directory if it doesn't exist
    const uploadDir = join(process.cwd(), 'public', 'uploads', 'products');
    await mkdir(uploadDir, { recursive: true });

    // Generate unique filename
    const ext = file.name.split('.').pop();
    const filename = `${randomUUID()}.${ext}`;
    const filepath = join(uploadDir, filename);

    // Write file
    await writeFile(filepath, buffer);

    const url = `/uploads/products/${filename}`;

    return {
      success: true,
      url,
    };
  } catch (error) {
    console.error('Upload error:', error);
    return { success: false, error: 'Failed to upload file' };
  }
}

export async function deleteProductImage(url: string) {
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
  try {
    // Extract filename from URL
    const filename = url.split('/').pop();
    if (!filename) return { success: false, error: 'Invalid URL' };

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
    return { success: false, error: 'Failed to delete file' };
  }
}
