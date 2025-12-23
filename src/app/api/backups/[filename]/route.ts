import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { auth } from '@/auth';
import { Role } from '@prisma/client';

const BACKUP_DIR = join(process.cwd(), 'backups');

export async function GET(
  request: NextRequest,
  { params }: { params: { filename: string } }
) {
  try {
    // Check authentication
    const session = await auth();
    if (!session?.user || session.user.role !== Role.ADMIN) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Sanitize filename to prevent directory traversal
    const filename = params.filename.replace(/[^a-zA-Z0-9._-]/g, '');
    if (!filename.endsWith('.sql')) {
      return NextResponse.json({ error: 'Invalid file type' }, { status: 400 });
    }

    const filepath = join(BACKUP_DIR, filename);

    // Read file
    const fileBuffer = await readFile(filepath);

    // Return file as download
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': 'application/sql',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    console.error('Error serving backup file:', error);
    if (error.code === 'ENOENT') {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

