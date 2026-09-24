import { NextRequest, NextResponse } from 'next/server';
import { readSystemSetting } from '@/lib/system-settings';
import { isBackupDue, runBackup, type BackupSchedule } from '@/lib/db-backup';

export const dynamic = 'force-dynamic';
// The whole database read once and written to the FTP server.
export const maxDuration = 60;

/**
 * The scheduled backup, checked once a day (vercel.json). It takes one only
 * when the schedule in Settings says today is the day and none was taken today.
 * Vercel sends `Authorization: Bearer $CRON_SECRET`; without it, refused.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
  }
  const schedule = (await readSystemSetting('backup_settings')) as BackupSchedule | undefined;
  const last = (await readSystemSetting('last_backup')) as { createdAt?: string } | undefined;
  if (!isBackupDue(schedule, last, new Date())) {
    return NextResponse.json({ ok: true, skipped: true });
  }
  try {
    const backup = await runBackup(schedule?.keepBackups ?? 30);
    return NextResponse.json({ ok: true, backup: backup.filename, sizeInMB: backup.sizeInMB });
  } catch (error: any) {
    console.error('[Backup] scheduled backup failed:', error);
    return NextResponse.json({ ok: false, message: error?.message ?? 'backup failed' }, { status: 500 });
  }
}
