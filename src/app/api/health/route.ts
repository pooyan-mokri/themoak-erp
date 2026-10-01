import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * For the host's health check (liara.json): 200 once the server answers and reaches its database, 503 when the
 * database does not answer. Says nothing else, and needs no sign-in.
 */
export async function GET() {
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
