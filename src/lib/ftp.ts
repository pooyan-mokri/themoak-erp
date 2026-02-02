'use server';

import { Client } from 'basic-ftp';
import { Readable } from 'stream';
import { getSetting } from '@/actions/settings';

interface FTPCredentials {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
  basePath?: string;
  ignoreCertificateErrors?: boolean;
}

/**
 * Get FTP client with credentials from settings
 */
async function getFTPClient(): Promise<Client> {
  const ftpCreds = (await getSetting('ftp_credentials')) as
    | FTPCredentials
    | undefined;

  if (!ftpCreds?.host || !ftpCreds?.user || !ftpCreds?.password) {
    throw new Error(
      'FTP credentials not configured. Please set FTP credentials in settings.'
    );
  }

  const client = new Client();
  client.ftp.verbose = false; // Set to true for debugging

  return client;
}

/**
 * Test FTP connection
 */
export async function testFTPConnection(): Promise<{
  success: boolean;
  error?: string;
}> {
  let client: Client | null = null;
  try {
    const ftpCreds = (await getSetting('ftp_credentials')) as
      | FTPCredentials
      | undefined;

    if (!ftpCreds?.host || !ftpCreds?.user || !ftpCreds?.password) {
      return {
        success: false,
        error: 'FTP credentials not configured',
      };
    }

    client = new Client();
    client.ftp.verbose = false;

    // Connect (passive mode is enabled by default in basic-ftp)
    const accessOptions: any = {
      host: ftpCreds.host,
      port: ftpCreds.port || 21,
      user: ftpCreds.user,
      password: ftpCreds.password,
      secure: ftpCreds.secure || false,
    };
    
    // If secure and ignoreCertificateErrors is enabled, disable strict SSL verification
    if (ftpCreds.secure && ftpCreds.ignoreCertificateErrors) {
      accessOptions.secureOptions = {
        rejectUnauthorized: false,
      };
    }
    
    await client.access(accessOptions);

    // Test by listing current directory
    await client.list();

    return { success: true };
  } catch (error: any) {
    console.error('[FTP] Connection test error:', error);

    // Provide more helpful error messages
    let errorMessage = error?.message || 'Failed to connect to FTP server';

    if (error?.code === 'ETIMEDOUT' || error?.message?.includes('ETIMEDOUT')) {
      errorMessage =
        'اتصال به سرور FTP زمان‌بر شد. این معمولاً به این معنی است که سرور FTP از IP های Vercel مسدود شده است. لطفاً بررسی کنید: 1) آدرس و پورت صحیح است 2) فایروال سرور اجازه اتصال از IP های Vercel می‌دهد 3) سرور FTP در دسترس است. ممکن است نیاز به whitelist کردن IP های Vercel در فایروال سرور باشد.';
    } else if (
      error?.code === 'ECONNREFUSED' ||
      error?.message?.includes('ECONNREFUSED')
    ) {
      errorMessage =
        'اتصال رد شد. لطفاً بررسی کنید: آدرس سرور و پورت صحیح است و سرور FTP در حال اجرا است.';
    } else if (
      error?.code === 'ENOTFOUND' ||
      error?.message?.includes('ENOTFOUND')
    ) {
      errorMessage = 'آدرس سرور پیدا نشد. لطفاً آدرس را بررسی کنید.';
    } else if (
      error?.message?.includes('certificate') ||
      error?.message?.includes('Hostname/IP does not match') ||
      error?.message?.includes("altnames")
    ) {
      errorMessage =
        'خطای گواهینامه SSL: نام هاست با گواهینامه سرور مطابقت ندارد. لطفاً گزینه "نادیده گرفتن خطاهای گواهینامه SSL" را در تنظیمات فعال کنید.';
    }

    console.error('[FTP] Connection test failed:', {
      code: error?.code,
      message: error?.message,
    });

    return {
      success: false,
      error: errorMessage,
    };
  } finally {
    if (client) {
      try {
        client.close();
      } catch (e) {
        // Ignore close errors
      }
    }
  }
}

/**
 * Upload file to FTP server
 */
export async function uploadToFTP(
  fileBuffer: Buffer,
  fileName: string
): Promise<{ url: string; path: string }> {
  let client: Client | null = null;
  try {
    const ftpCreds = (await getSetting('ftp_credentials')) as
      | FTPCredentials
      | undefined;

    if (!ftpCreds?.host || !ftpCreds?.user || !ftpCreds?.password) {
      throw new Error('FTP credentials not configured');
    }

    client = new Client();
    client.ftp.verbose = false;

    // Connect (passive mode is enabled by default in basic-ftp)
    const accessOptions: any = {
      host: ftpCreds.host,
      port: ftpCreds.port || 21,
      user: ftpCreds.user,
      password: ftpCreds.password,
      secure: ftpCreds.secure || false,
    };
    
    // If secure and ignoreCertificateErrors is enabled, disable strict SSL verification
    if (ftpCreds.secure && ftpCreds.ignoreCertificateErrors) {
      accessOptions.secureOptions = {
        rejectUnauthorized: false,
      };
    }
    
    await client.access(accessOptions);

    // Navigate to base path if specified
    const basePath = ftpCreds.basePath || '/uploads/receipts';
    try {
      await client.ensureDir(basePath);
    } catch (error) {
      console.warn(
        '[FTP] Could not ensure directory, trying to create:',
        error
      );
      // Try to create directory
      await client.ensureDir(basePath);
    }

    // Upload file
    const remotePath = `${basePath}/${fileName}`;
    // Convert Buffer to Readable stream
    const stream = Readable.from(fileBuffer);
    await client.uploadFrom(stream, remotePath);

    // Construct URL (assuming FTP server is accessible via HTTP)
    // You may need to adjust this based on your FTP server setup
    const url = `ftp:${remotePath}`;

    return { url, path: remotePath };
  } catch (error: any) {
    console.error('[FTP] Upload error:', error);
    throw new Error(error?.message || 'Failed to upload to FTP server');
  } finally {
    if (client) {
      try {
        client.close();
      } catch (e) {
        // Ignore close errors
      }
    }
  }
}

/**
 * Delete file from FTP server
 */
export async function deleteFromFTP(filePath: string): Promise<void> {
  let client: Client | null = null;
  try {
    const ftpCreds = (await getSetting('ftp_credentials')) as
      | FTPCredentials
      | undefined;

    if (!ftpCreds?.host || !ftpCreds?.user || !ftpCreds?.password) {
      throw new Error('FTP credentials not configured');
    }

    client = new Client();
    client.ftp.verbose = false;

    // Connect (passive mode is enabled by default in basic-ftp)
    const accessOptions: any = {
      host: ftpCreds.host,
      port: ftpCreds.port || 21,
      user: ftpCreds.user,
      password: ftpCreds.password,
      secure: ftpCreds.secure || false,
    };
    
    // If secure and ignoreCertificateErrors is enabled, disable strict SSL verification
    if (ftpCreds.secure && ftpCreds.ignoreCertificateErrors) {
      accessOptions.secureOptions = {
        rejectUnauthorized: false,
      };
    }
    
    await client.access(accessOptions);

    // Remove ftp: prefix if present
    const cleanPath = filePath.startsWith('ftp:')
      ? filePath.slice(4)
      : filePath;

    // Delete file
    await client.remove(cleanPath);
  } catch (error: any) {
    console.error('[FTP] Delete error:', error);
    throw new Error(error?.message || 'Failed to delete from FTP server');
  } finally {
    if (client) {
      try {
        client.close();
      } catch (e) {
        // Ignore close errors
      }
    }
  }
}
