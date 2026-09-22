import { uploadReceipt } from '@/actions/upload';
import { RECEIPT_MAX_BYTES } from '@/lib/receipt-ref';

const MAX_SIDE = 2000;

/**
 * A phone photo is several megabytes; a receipt still reads well at 2000 px as
 * a JPEG, which also keeps it under the upload limit. A PDF goes as it is.
 */
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const allowed = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
    if (scale === 1 && allowed && file.size <= 1024 * 1024) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff'; // a transparent screenshot must not turn black
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return (await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.85))) ?? file;
  } catch {
    // A format this browser cannot draw: send it, and the server says whether it is allowed.
    return file;
  }
}

/** Uploads a receipt from a file picker; the reference is saved on a money row afterwards. */
export async function uploadReceiptFile(file: File): Promise<{ ref: string; type: string } | { error: string }> {
  const body = await shrink(file);
  if (body.size > RECEIPT_MAX_BYTES) return { error: 'حجم فایل نباید بیشتر از ۴ مگابایت باشد.' };
  const form = new FormData();
  form.append('file', body, file.name);
  try {
    const result = await uploadReceipt(form);
    if (result.success && 'url' in result && result.url) return { ref: result.url, type: result.type };
    return { error: result.error || 'خطا در آپلود فایل' };
  } catch {
    return { error: 'خطا در ارتباط با سرور؛ دوباره تلاش کنید.' };
  }
}
