import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { presenceBoard } from '@/lib/world-presence';

export const dynamic = 'force-dynamic';

/**
 * Presence in the business world (src/lib/world-presence.ts): POST your
 * figure's place, get everyone else who is there. DELETE when leaving.
 * Every signed-in, active user; names come from the database, not the client.
 */
async function signedIn() {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, role: true, isActive: true } });
  return user?.isActive ? user : null;
}

export async function POST(req: NextRequest) {
  const user = await signedIn();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const me = presenceBoard.report(user, body);
  if (!me) return NextResponse.json({ error: 'Invalid position' }, { status: 422 });
  const others = presenceBoard.others(user.id).map(({ userId, name, role, x, z, yaw, district, at }) => ({ userId, name, role, x, z, yaw, district, at }));
  return NextResponse.json({ others }, { headers: { 'cache-control': 'no-store' } });
}

export async function DELETE() {
  const user = await signedIn();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  presenceBoard.leave(user.id);
  return NextResponse.json({ ok: true });
}
