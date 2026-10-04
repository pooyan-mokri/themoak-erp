import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentRole } from '@/lib/access';
import { ROLES } from '@/lib/permissions';
import { buildWorldHistory } from '@/lib/world-history';

export const dynamic = 'force-dynamic';

/** The time machine's last 30 days (src/lib/world-history.ts), for the signed-in user's role. */
export async function GET() {
  const role = await getCurrentRole();
  if (!role) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(ROLES as readonly string[]).includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json(await buildWorldHistory(prisma, role), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('[World] history failed:', error);
    return NextResponse.json({ error: 'تاریخچه خوانده نشد.' }, { status: 500 });
  }
}
