'use server';

import { writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getSetting } from './settings';
import { uploadToFTP, deleteFromFTP } from '@/lib/ftp';

export async function uploadReceipt(formData: FormData) {
  try {
    const file = formData.get('file') as File;

    if (!file) {
      return { success: false, error: 'No file provided' };
    }

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      return {
        success: false,
        error: 'Invalid file type. Only JPG, PNG and PDF allowed.',
      };
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      return { success: false, error: 'File size too large. Max 5MB allowed.' };
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Check if FTP is configured
    const ftpCredentials = await getSetting('ftp_credentials');

    if (ftpCredentials) {
      try {
        // Upload to FTP
        const ext = file.name.split('.').pop();
        const filename = `${randomUUID()}.${ext}`;

        console.log('[Upload] Attempting FTP upload:', filename);
        const ftpResult = await uploadToFTP(buffer, filename);

        console.log('[Upload] FTP upload successful:', ftpResult.path);

        return {
          success: true,
          url: ftpResult.url,
          type: file.type,
        };
      } catch (error: any) {
        console.error('[Upload] FTP upload error:', error);
        console.error('[Upload] Error details:', {
          message: error?.message,
        });

        // On Vercel, local storage is not available, so we must fail if FTP fails
        const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_URL;

        if (isVercel) {
          const errorMessage = error?.message || 'Failed to upload to FTP server';
          return {
            success: false,
            error: `خطا در آپلود به FTP: ${errorMessage}. لطفاً تنظیمات FTP را بررسی کنید.`,
          };
        }

        // Fall back to local storage only in non-Vercel environments
        console.log('[Upload] Falling back to local storage...');
      }
    }

    // Fallback to local storage (only works locally, not on Vercel)
    const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_URL;
    if (isVercel) {
      return {
        success: false,
        error:
          'FTP تنظیم نشده است. لطفاً در تنظیمات اطلاعات FTP را وارد کنید.',
      };
    }

    const uploadDir = join(process.cwd(), 'public', 'uploads', 'receipts');
    await mkdir(uploadDir, { recursive: true });

    // Generate unique filename
    const ext = file.name.split('.').pop();
    const filename = `${randomUUID()}.${ext}`;
    const filepath = join(uploadDir, filename);

    // Write file
    await writeFile(filepath, buffer);

    const url = `/uploads/receipts/${filename}`;

    return {
      success: true,
      url,
      type: file.type,
    };
  } catch (error) {
    console.error('Upload error:', error);
    return { success: false, error: 'Failed to upload file' };
  }
}

export async function deleteReceipt(url: string) {
  try {
    // Check if it's an FTP URL
    if (url.startsWith('ftp:')) {
      await deleteFromFTP(url);
      return { success: true };
    }

    // Local file deletion
    const filename = url.split('/').pop();
    if (!filename) return { success: false, error: 'Invalid URL' };

    const filepath = join(
      process.cwd(),
      'public',
      'uploads',
      'receipts',
      filename
    );

    await unlink(filepath);

    return { success: true };
  } catch (error) {
    console.error('Delete error:', error);
    return { success: false, error: 'Failed to delete file' };
  }
}

/**
 * Get viewable URL for a receipt (handles both local and FTP)
 */
export async function getReceiptViewUrl(url: string): Promise<string> {
  if (url.startsWith('ftp:')) {
    // For FTP, you may need to construct a web-accessible URL
    // This depends on your FTP server setup (e.g., if it's accessible via HTTP)
    // For now, return the FTP path
    return url;
  }
  // For local files, return as-is (relative URL)
  return url;
}

export async function uploadProductImage(formData: FormData) {
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
