'use server';

import { auth } from '@/auth';
import { Role } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { saveSetting } from './settings';
import { readSystemSetting } from '@/lib/system-settings';
import { listFromFTP } from '@/lib/ftp';
import { BACKUP_FOLDER, isBackupName, runBackup } from '@/lib/db-backup';

// Create manual backup: the whole database as SQL, stored on the FTP server
export async function createBackup() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== Role.ADMIN) {
      return { success: false as const, error: 'دسترسی غیرمجاز' };
    }

    const schedule = (await readSystemSetting('backup_settings')) as { keepBackups?: number } | undefined;
    const backup = await runBackup(schedule?.keepBackups ?? 30);
    revalidatePath('/dashboard/settings/backup');
    return { success: true as const, ...backup };
  } catch (error: any) {
    console.error('Error creating backup:', error);
    return {
      success: false as const,
      error: `بک‌آپ گرفته نشد: ${error?.message || 'خطای نامشخص'}`,
    };
  }
}

// Get backup settings
export async function getBackupSettings() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== Role.ADMIN) {
      return undefined;
    }

    return await readSystemSetting('backup_settings');
  } catch (error) {
    console.error('Error fetching backup settings:', error);
    return undefined;
  }
}

// Save backup settings
export async function saveBackupSettings(settings: {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  time?: string; // HH:MM format
  dayOfWeek?: number; // 0-6 for weekly (0 = Sunday)
  dayOfMonth?: number; // 1-31 for monthly
  keepBackups?: number; // Number of backups to keep
}) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== Role.ADMIN) {
      return { success: false, error: 'دسترسی غیرمجاز' };
    }

    await saveSetting('backup_settings', settings);
    revalidatePath('/dashboard/settings/backup');
    return { success: true };
  } catch (error: any) {
    console.error('Error saving backup settings:', error);
    return { success: false, error: error.message || 'خطا در ذخیره تنظیمات' };
  }
}

// Get last backup info
export async function getLastBackup() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== Role.ADMIN) {
      return undefined;
    }

    return await readSystemSetting('last_backup');
  } catch (error) {
    return undefined;
  }
}

// List the backups on the FTP server
export async function listBackups() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== Role.ADMIN) {
      return { success: false, error: 'دسترسی غیرمجاز' };
    }

    const files = await listFromFTP(BACKUP_FOLDER);
    const backups = files
      .filter((file) => isBackupName(file.name))
      .map((file) => ({
        filename: file.name,
        downloadUrl: `/api/backups/${file.name}`,
        size: file.size,
        sizeInMB: (file.size / (1024 * 1024)).toFixed(2),
        // The name carries when it was taken: backup-2026-09-24T12-02-11.sql (UTC)
        createdAt: file.name.slice(7, 26).replace(/T(\d{2})-(\d{2})-(\d{2})/, 'T$1:$2:$3') + 'Z',
      }));

    return { success: true, backups };
  } catch (error: any) {
    console.error('Error listing backups:', error);
    return { success: false, error: error.message || 'خطا در دریافت لیست بک‌آپ‌ها' };
  }
}
