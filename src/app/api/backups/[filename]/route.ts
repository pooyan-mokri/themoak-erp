import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { Role } from '@prisma/client';
import { downloadFromFTP } from '@/lib/ftp';
import { BACKUP_FOLDER, isBackupName } from '@/lib/db-backup';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Downloads one database backup from the FTP server: admins only. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== Role.ADMIN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only a name the backup writer makes: no path, no other file on the server.
  const { filename } = await params;
  if (!isBackupName(filename)) {
    return NextResponse.json({ error: 'Invalid file name' }, { status: 400 });
  }

  try {
    const bytes = await downloadFromFTP(`${BACKUP_FOLDER}/${filename}`);
    if (!bytes) return NextResponse.json({ error: 'Backup not found' }, { status: 404 });
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/sql; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Error downloading backup:', error);
    return NextResponse.json({ error: 'دسترسی به سرور FTP ممکن نشد' }, { status: 502 });
  }
}
