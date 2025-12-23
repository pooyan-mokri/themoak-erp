'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { Role } from '@prisma/client';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { revalidatePath } from 'next/cache';
import { saveSetting, getSetting } from './settings';

const execAsync = promisify(exec);

// Backup directory
const BACKUP_DIR = join(process.cwd(), 'backups');

// Ensure backup directory exists
async function ensureBackupDir() {
  try {
    await mkdir(BACKUP_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
}

// Parse DATABASE_URL and extract connection info
function parseDatabaseUrl(url: string) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port || '5432',
      database: parsed.pathname.slice(1),
      user: parsed.username,
      password: parsed.password,
    };
  } catch (error) {
    throw new Error('Invalid DATABASE_URL');
  }
}

// Create manual backup
export async function createBackup() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== Role.ADMIN) {
      return { success: false, error: 'دسترسی غیرمجاز' };
    }

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      return { success: false, error: 'DATABASE_URL تنظیم نشده است' };
    }

    await ensureBackupDir();

    const dbInfo = parseDatabaseUrl(databaseUrl);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `backup-${timestamp}.sql`;
    const filepath = join(BACKUP_DIR, filename);

    // Create pg_dump command
    // Use PGPASSWORD environment variable to avoid password prompt in command
    const pgDumpCommand = `pg_dump -h ${dbInfo.host} -p ${dbInfo.port} -U ${dbInfo.user} -d ${dbInfo.database} -F p -f "${filepath}"`;

    await execAsync(pgDumpCommand, {
      env: { 
        ...process.env, 
        PGPASSWORD: dbInfo.password, // Set password via env to avoid shell injection
      },
    });

    // Get file size
    const fs = await import('fs/promises');
    const stats = await fs.stat(filepath);
    const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

    // Save backup record
    const backupInfo = {
      filename,
      filepath: `/api/backups/${filename}`,
      size: stats.size,
      sizeInMB,
      createdAt: new Date().toISOString(),
    };

    // Save to database (optional - can track backups)
    await saveSetting('last_backup', backupInfo);

    return {
      success: true,
      filename,
      downloadUrl: `/api/backups/${filename}`,
      size: stats.size,
      sizeInMB,
    };
  } catch (error: any) {
    console.error('Error creating backup:', error);
    return {
      success: false,
      error: error.message || 'خطا در ایجاد بک‌آپ',
    };
  }
}

// Get backup settings
export async function getBackupSettings() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== Role.ADMIN) {
      return null;
    }

    return await getSetting('backup_settings');
  } catch (error) {
    console.error('Error fetching backup settings:', error);
    return null;
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
    return await getSetting('last_backup');
  } catch (error) {
    return null;
  }
}

// List available backups
export async function listBackups() {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== Role.ADMIN) {
      return { success: false, error: 'دسترسی غیرمجاز' };
    }

    await ensureBackupDir();
    const fs = await import('fs/promises');
    const files = await fs.readdir(BACKUP_DIR);
    
    const backups = await Promise.all(
      files
        .filter(file => file.endsWith('.sql'))
        .map(async (file) => {
          const filepath = join(BACKUP_DIR, file);
          const stats = await fs.stat(filepath);
          return {
            filename: file,
            downloadUrl: `/api/backups/${file}`,
            size: stats.size,
            sizeInMB: (stats.size / (1024 * 1024)).toFixed(2),
            createdAt: stats.birthtime.toISOString(),
          };
        })
    );

    // Sort by creation date (newest first)
    backups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return { success: true, backups };
  } catch (error: any) {
    console.error('Error listing backups:', error);
    return { success: false, error: error.message || 'خطا در دریافت لیست بک‌آپ‌ها' };
  }
}

