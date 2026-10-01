// Server-only helpers for src/lib/receipt-storage.ts and src/actions/ftp.ts, whose callers check access first.
// Deliberately not a 'use server' file: that would make every export a public endpoint.
import { Client } from 'basic-ftp';
import { Readable, Writable } from 'stream';
import { readSystemSetting } from '@/lib/system-settings';

/** Shown on the settings and backup pages: the code's own messages are Persian. */
export const FTP_NOT_CONFIGURED = 'اطلاعات سرور FTP در تنظیمات وارد نشده است.';

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
  const ftpCreds = (await readSystemSetting('ftp_credentials')) as
    | FTPCredentials
    | undefined;

  if (!ftpCreds?.host || !ftpCreds?.user || !ftpCreds?.password) {
    throw new Error(FTP_NOT_CONFIGURED);
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
    const ftpCreds = (await readSystemSetting('ftp_credentials')) as
      | FTPCredentials
      | undefined;

    if (!ftpCreds?.host || !ftpCreds?.user || !ftpCreds?.password) {
      return {
        success: false,
        error: FTP_NOT_CONFIGURED,
      };
    }

    client = new Client();
    client.ftp.verbose = false;

    // Connect (passive mode is enabled by default in basic-ftp)
    // Fail fast: a serverless function has a hard execution limit, so a
    // hanging FTP handshake must surface as an error rather than a dead request.
    (client.ftp as any).timeout = 15000;

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
    let errorMessage = error?.message || 'اتصال به سرور FTP برقرار نشد.';

    if (error?.code === 'ETIMEDOUT' || error?.message?.includes('ETIMEDOUT')) {
      errorMessage =
        'اتصال به سرور FTP زمان‌بر شد. این معمولاً به این معنی است که سرور FTP اتصال از IP سرور ERP را مسدود کرده است. لطفاً بررسی کنید: 1) آدرس و پورت صحیح است 2) فایروال سرور FTP اجازه اتصال از IP سرور ERP را می‌دهد 3) سرور FTP در دسترس است. ممکن است نیاز به whitelist کردن IP سرور ERP در فایروال سرور FTP باشد.';
    } else if (
      error?.code === 'ECONNREFUSED' ||
      error?.message?.includes('ECONNREFUSED')
    ) {
      errorMessage =
        'اتصال رد شد (ECONNREFUSED): درخواست به سرور رسید اما سرور آن را فعالانه رد کرد. ' +
        'رایج‌ترین علت این است که فایروال میزبان FTP، اتصال از IP سرور ERP را مسدود می‌کند (مثلاً IP های خارج از ایران). ' +
        'برای بررسی: همین آدرس، پورت و نام کاربری را با یک نرم‌افزار FTP از کامپیوتر خودتان تست کنید؛ ' +
        'اگر از آنجا وصل شد، مشکل مسدودسازی IP است و باید از پشتیبانی هاست بخواهید IP سرور ERP را در فایروال مجاز کند ' +
        '(یا از روش جایگزین غیر-FTP برای ذخیره فایل استفاده شود). ' +
        'همچنین مطمئن شوید سرویس FTP روی پورت واردشده فعال است (۲۱ برای FTPS صریح، ۹۹۰ برای FTPS ضمنی).';
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
  fileName: string,
  /** A folder other than the receipts one in Settings (database backups). */
  folder?: string
): Promise<{ url: string; path: string }> {
  let client: Client | null = null;
  try {
    const ftpCreds = (await readSystemSetting('ftp_credentials')) as
      | FTPCredentials
      | undefined;

    if (!ftpCreds?.host || !ftpCreds?.user || !ftpCreds?.password) {
      throw new Error(FTP_NOT_CONFIGURED);
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
    // A folder typed with a trailing slash made every path `//name`, which no receipt reference accepts.
    const basePath = (folder || ftpCreds.basePath || '/uploads/receipts').replace(/\/+$/, '');
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
    throw new Error(error?.message || 'آپلود به سرور FTP انجام نشد.');
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
    const ftpCreds = (await readSystemSetting('ftp_credentials')) as
      | FTPCredentials
      | undefined;

    if (!ftpCreds?.host || !ftpCreds?.user || !ftpCreds?.password) {
      throw new Error(FTP_NOT_CONFIGURED);
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
    throw new Error(error?.message || 'حذف از سرور FTP انجام نشد.');
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
 * Read a file from the FTP server (a receipt, for src/app/api/receipts), or
 * null when there is no such file.
 */
export async function downloadFromFTP(filePath: string): Promise<Buffer | null> {
  let client: Client | null = null;
  try {
    const ftpCreds = (await readSystemSetting('ftp_credentials')) as
      | FTPCredentials
      | undefined;

    if (!ftpCreds?.host || !ftpCreds?.user || !ftpCreds?.password) {
      throw new Error(FTP_NOT_CONFIGURED);
    }

    client = new Client();
    client.ftp.verbose = false;
    // A viewer waits on this request: fail rather than hang.
    (client.ftp as any).timeout = 15000;

    const accessOptions: any = {
      host: ftpCreds.host,
      port: ftpCreds.port || 21,
      user: ftpCreds.user,
      password: ftpCreds.password,
      secure: ftpCreds.secure || false,
    };

    if (ftpCreds.secure && ftpCreds.ignoreCertificateErrors) {
      accessOptions.secureOptions = {
        rejectUnauthorized: false,
      };
    }

    await client.access(accessOptions);

    const cleanPath = filePath.startsWith('ftp:')
      ? filePath.slice(4)
      : filePath;

    const chunks: Buffer[] = [];
    const sink = new Writable({
      write(chunk, _encoding, done) {
        chunks.push(Buffer.from(chunk));
        done();
      },
    });
    await client.downloadTo(sink, cleanPath);
    return Buffer.concat(chunks);
  } catch (error: any) {
    // 550: no such file.
    if (error?.code === 550) return null;
    console.error('[FTP] Download error:', error);
    throw new Error(error?.message || 'دریافت از سرور FTP انجام نشد.');
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

/** The files in a folder on the FTP server, newest first; empty when the folder does not exist. */
export async function listFromFTP(
  folder: string
): Promise<Array<{ name: string; size: number; modifiedAt: string | null }>> {
  let client: Client | null = null;
  try {
    const ftpCreds = (await readSystemSetting('ftp_credentials')) as
      | FTPCredentials
      | undefined;

    if (!ftpCreds?.host || !ftpCreds?.user || !ftpCreds?.password) {
      throw new Error(FTP_NOT_CONFIGURED);
    }

    client = new Client();
    client.ftp.verbose = false;
    (client.ftp as any).timeout = 15000;

    const accessOptions: any = {
      host: ftpCreds.host,
      port: ftpCreds.port || 21,
      user: ftpCreds.user,
      password: ftpCreds.password,
      secure: ftpCreds.secure || false,
    };

    if (ftpCreds.secure && ftpCreds.ignoreCertificateErrors) {
      accessOptions.secureOptions = {
        rejectUnauthorized: false,
      };
    }

    await client.access(accessOptions);

    let entries;
    try {
      entries = await client.list(folder);
    } catch (error: any) {
      // 550: the folder has not been created yet.
      if (error?.code === 550) return [];
      throw error;
    }
    return entries
      .filter((entry) => entry.isFile)
      .map((entry) => ({
        name: entry.name,
        size: entry.size,
        modifiedAt: entry.modifiedAt ? entry.modifiedAt.toISOString() : null,
      }))
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch (error: any) {
    console.error('[FTP] List error:', error);
    throw new Error(error?.message || 'فهرست پوشهٔ FTP خوانده نشد.');
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
