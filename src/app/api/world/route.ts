import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentRole } from '@/lib/access';
import { ROLES } from '@/lib/permissions';
import { buildWorld } from '@/lib/world-data';

export const dynamic = 'force-dynamic';

/**
 * The business world's snapshot (src/lib/world-data.ts) for the signed-in user,
 * polled by /dashboard/world so it is always current. Each role gets only the
 * parts it may see; a stranger gets nothing.
 */
export async function GET() {
  const role = await getCurrentRole();
  if (!role) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(ROLES as readonly string[]).includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const world = await buildWorld(prisma, role);
    return NextResponse.json(world, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('[World] snapshot failed:', error);
    return NextResponse.json({ error: 'دادهٔ دنیا خوانده نشد.' }, { status: 500, headers: { 'cache-control': 'no-store' } });
  }
}
