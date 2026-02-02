'use server';

import { writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getSetting } from './settings';
import { uploadToGoogleDrive, deleteFromGoogleDrive } from '@/lib/google-drive';

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

    // Check if Google Drive is connected
    const googleDriveCredentials = await getSetting('google_drive_credentials');

    if (googleDriveCredentials) {
      try {
        // Upload to Google Drive
        const ext = file.name.split('.').pop();
        const filename = `${randomUUID()}.${ext}`;

        console.log('[Upload] Attempting Google Drive upload:', filename);
        const driveResult = await uploadToGoogleDrive(
          buffer,
          filename,
          file.type
        );

        console.log('[Upload] Google Drive upload successful:', driveResult.fileId);

        // Store fileId in URL format for later retrieval
        const url = `gdrive:${driveResult.fileId}`;

        return {
          success: true,
          url,
          type: file.type,
          webViewLink: driveResult.webViewLink,
        };
      } catch (error: any) {
        console.error('[Upload] Google Drive upload error:', error);
        console.error('[Upload] Error details:', {
          message: error?.message,
          code: error?.code,
          errors: error?.errors,
        });
        
        // On Vercel, local storage is not available, so we must fail if Google Drive fails
        const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_URL;
        
        if (isVercel) {
          // On Vercel, we can't use local storage, so return the error
          const errorMessage = error?.message || 'Failed to upload to Google Drive';
          return {
            success: false,
            error: `خطا در آپلود به Google Drive: ${errorMessage}. لطفاً اتصال Google Drive را بررسی کنید.`,
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
        error: 'Google Drive متصل نیست. لطفاً در تنظیمات به Google Drive متصل شوید.',
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
    // Check if it's a Google Drive URL
    if (url.startsWith('gdrive:')) {
      const fileId = url.replace('gdrive:', '');
      await deleteFromGoogleDrive(fileId);
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
 * Get viewable URL for a receipt (handles both local and Google Drive)
 */
export async function getReceiptViewUrl(url: string): Promise<string> {
  if (url.startsWith('gdrive:')) {
    // For Google Drive, return a view link
    const fileId = url.replace('gdrive:', '');
    return `https://drive.google.com/file/d/${fileId}/view`;
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

/**
 * Download image from URL and save it to products folder
 */
export async function downloadAndSaveProductImage(
  imageUrl: string
): Promise<string | undefined> {
  try {
    console.log(`[Image Download] Starting download from: ${imageUrl}`);

    // Validate URL
    if (!imageUrl || typeof imageUrl !== 'string') {
      console.error('[Image Download] Invalid URL:', imageUrl);
      return undefined;
    }

    // Normalize URL - handle both http and https
    const normalizedUrl = imageUrl.trim();
    if (
      !normalizedUrl.startsWith('http://') &&
      !normalizedUrl.startsWith('https://')
    ) {
      console.error(
        '[Image Download] URL does not start with http/https:',
        normalizedUrl
      );
      return undefined;
    }

    console.log(`[Image Download] Fetching image from: ${normalizedUrl}`);

    // Fetch image with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch(normalizedUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ThemoakERP/1.0)',
        },
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(
          `[Image Download] HTTP error: ${response.status} ${response.statusText}`
        );
        return undefined;
      }

      const contentType = response.headers.get('content-type') || '';
      console.log(`[Image Download] Content-Type: ${contentType}`);

      // Check if it's an image
      if (!contentType.startsWith('image/')) {
        // Try to get extension from URL as fallback
        const urlExt = normalizedUrl
          .split('.')
          .pop()
          ?.split('?')[0]
          ?.toLowerCase();
        if (
          !urlExt ||
          !['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(urlExt)
        ) {
          console.error(
            `[Image Download] Invalid content type: ${contentType}`
          );
          return undefined;
        }
      }

      // Get file extension from content type or URL
      let ext = 'jpg';
      if (contentType.includes('png')) ext = 'png';
      else if (contentType.includes('webp')) ext = 'webp';
      else if (contentType.includes('gif')) ext = 'gif';
      else if (contentType.includes('jpeg')) ext = 'jpg';
      else {
        // Try to get extension from URL
        const urlExt = normalizedUrl
          .split('.')
          .pop()
          ?.split('?')[0]
          ?.toLowerCase();
        if (urlExt && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(urlExt)) {
          ext = urlExt === 'jpeg' ? 'jpg' : urlExt;
        }
      }

      console.log(`[Image Download] File extension: ${ext}`);

      // Convert response to buffer
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      console.log(`[Image Download] Downloaded ${buffer.length} bytes`);

      // Validate file size (10MB)
      if (buffer.length > 10 * 1024 * 1024) {
        console.error(
          `[Image Download] Image file too large: ${buffer.length} bytes`
        );
        return undefined;
      }

      if (buffer.length === 0) {
        console.error('[Image Download] Empty file downloaded');
        return undefined;
      }

      // Create uploads directory if it doesn't exist
      const uploadDir = join(process.cwd(), 'public', 'uploads', 'products');
      await mkdir(uploadDir, { recursive: true });
      console.log(`[Image Download] Upload directory: ${uploadDir}`);

      // Generate unique filename
      const filename = `${randomUUID()}.${ext}`;
      const filepath = join(uploadDir, filename);

      console.log(`[Image Download] Saving to: ${filepath}`);

      // Write file
      await writeFile(filepath, buffer);

      const url = `/uploads/products/${filename}`;
      console.log(`[Image Download] Successfully saved image: ${url}`);
      return url;
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        console.error('[Image Download] Request timeout');
      } else {
        console.error('[Image Download] Fetch error:', fetchError.message);
      }
      return undefined;
    }
  } catch (error: any) {
    console.error(
      '[Image Download] Error downloading and saving product image:',
      error.message || error
    );
    return undefined;
  }
}
