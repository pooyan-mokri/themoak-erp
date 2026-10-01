import { NextRequest, NextResponse } from 'next/server';
import { runScheduledBackup } from '@/lib/db-backup';

export const dynamic = 'force-dynamic';
// The whole database read once and written to the FTP server.
export const maxDuration = 60;

/**
 * The scheduled backup, checked once a day (liara.json's cron; vercel.json's
 * until the move). It takes one only when the schedule in Settings says today
 * is the day and none was taken today, and only one when two instances check
 * at once. The caller sends `Authorization: Bearer $CRON_SECRET`; without it,
 * refused.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
  }
  try {
    const backup = await runScheduledBackup();
    if (!backup) return NextResponse.json({ ok: true, skipped: true });
    return NextResponse.json({ ok: true, backup: backup.filename, sizeInMB: backup.sizeInMB });
  } catch (error: any) {
    console.error('[Backup] scheduled backup failed:', error);
    return NextResponse.json({ ok: false, message: error?.message ?? 'backup failed' }, { status: 500 });
  }
}
