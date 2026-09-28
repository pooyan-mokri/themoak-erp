'use server';

import { testFTPConnection } from '@/lib/ftp';
import { saveSetting } from './settings';
import { readSystemSetting } from '@/lib/system-settings';
import { auth } from '@/auth';
import { Role } from '@prisma/client';
import { ACCESS_DENIED_MESSAGE } from '@/lib/access';

// The folder rule of a receipt reference (src/lib/receipt-ref.ts): a folder the
// receipt viewer would refuse makes every upload fail.
const FOLDER = /^(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+$/;

type FtpSettings = {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
  basePath?: string;
  ignoreCertificateErrors?: boolean;
};

export async function saveFTPCredentials(credentials: {
  host: string;
  port: number;
  user: string;
  /** Empty keeps the saved password. */
  password?: string;
  secure: boolean;
  basePath?: string;
  ignoreCertificateErrors?: boolean;
}) {
  const session = await auth();

  if (!session?.user || session.user.role !== Role.ADMIN) {
    return { success: false, error: ACCESS_DENIED_MESSAGE };
  }

  const basePath = (credentials.basePath ?? '').trim().replace(/\/+$/, '');
  if (!credentials.host?.trim() || !credentials.user?.trim()) {
    return { success: false, error: 'آدرس سرور و نام کاربری FTP را وارد کنید.' };
  }
  if (!Number.isInteger(credentials.port) || credentials.port < 1 || credentials.port > 65535) {
    return { success: false, error: 'پورت FTP باید عددی بین ۱ تا ۶۵۵۳۵ باشد.' };
  }
  if (basePath && !FOLDER.test(basePath)) {
    return {
      success: false,
      error: 'مسیر پوشه باید با / شروع شود و فقط حروف و اعداد انگلیسی، نقطه، - و _ داشته باشد؛ مثل /uploads/receipts',
    };
  }

  // The page never receives the saved password, so an empty field keeps it;
  // but only for the server and login it was saved for.
  const stored = (await readSystemSetting('ftp_credentials')) as FtpSettings | undefined;
  let password = credentials.password ?? '';
  if (!password) {
    if (!stored?.password) return { success: false, error: 'رمز عبور FTP را وارد کنید.' };
    if (stored.host !== credentials.host.trim() || stored.user !== credentials.user.trim()) {
      return { success: false, error: 'با تغییر سرور یا نام کاربری FTP، رمز عبور را دوباره وارد کنید.' };
    }
    password = stored.password;
  }

  try {
    const saved = await saveSetting('ftp_credentials', {
      ...credentials,
      host: credentials.host.trim(),
      user: credentials.user.trim(),
      password,
      basePath: basePath || undefined,
    });
    return saved.success ? { success: true } : saved;
  } catch (error) {
    console.error('Error saving FTP credentials:', error);
    return { success: false, error: 'ذخیرهٔ تنظیمات FTP انجام نشد.' };
  }
}

export async function getFTPCredentials() {
  const session = await auth();

  if (!session?.user || session.user.role !== Role.ADMIN) {
    return null;
  }

  try {
    const creds = (await readSystemSetting('ftp_credentials')) as FtpSettings | undefined;
    if (!creds) return null;
    // The password never goes to the browser: only whether one is saved.
    const { password, ...shown } = creds;
    return { ...shown, hasPassword: Boolean(password) };
  } catch (error) {
    console.error('Error getting FTP credentials:', error);
    return null;
  }
}

export async function testFTPConnectionAction() {
  const session = await auth();

  if (!session?.user || session.user.role !== Role.ADMIN) {
    return { success: false, error: ACCESS_DENIED_MESSAGE };
  }

  try {
    const result = await testFTPConnection();
    return result;
  } catch (error: any) {
    console.error('Error testing FTP connection:', error);
    return {
      success: false,
      error: error?.message || 'آزمایش اتصال FTP انجام نشد.',
    };
  }
}

