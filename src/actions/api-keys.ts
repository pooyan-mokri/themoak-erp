'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { checkPermission } from '@/lib/access';
import { logActivity } from '@/lib/activity-log';
import { newApiKey } from '@/lib/api-keys';

/** Personal keys for Claude's ERP connector (src/lib/api-keys.ts): an admin's matter, like the users themselves. */

export type ApiKeyRow = { id: string; name: string; prefix: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null };

export async function listApiKeys(userId: string): Promise<{ success: true; keys: ApiKeyRow[] } | { success: false; message: string }> {
  const denied = await checkPermission('users.manage');
  if (denied) return denied;
  const keys = await prisma.apiKey.findMany({
    where: { userId },
    select: { id: true, name: true, prefix: true, createdAt: true, lastUsedAt: true, revokedAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return { success: true, keys };
}

/** Makes a key for a user. The key itself is in the answer once and never again. */
export async function createApiKey(userId: string, name: string): Promise<{ success: true; key: string; prefix: string } | { success: false; message: string }> {
  const denied = await checkPermission('users.manage');
  if (denied) return denied;
  const label = String(name ?? '').trim().slice(0, 60) || 'Claude';
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, isActive: true } });
  if (!user) return { success: false, message: 'کاربر پیدا نشد.' };
  if (!user.isActive) return { success: false, message: 'این کاربر غیرفعال است؛ اول فعالش کنید.' };
  const session = await auth();
  const { key, prefix, hash } = newApiKey();
  await prisma.apiKey.create({ data: { userId, name: label, prefix, hash, createdBy: session?.user?.id ?? null } });
  await logActivity(session?.user?.id, 'API_KEY_CREATED', `کلید «${label}» (${prefix}…) برای ${user.name} ساخته شد`);
  return { success: true, key, prefix };
}

export async function revokeApiKey(id: string): Promise<{ success: boolean; message: string }> {
  const denied = await checkPermission('users.manage');
  if (denied) return denied;
  const row = await prisma.apiKey.findUnique({ where: { id }, select: { id: true, name: true, prefix: true, revokedAt: true, user: { select: { name: true } } } });
  if (!row) return { success: false, message: 'کلید پیدا نشد.' };
  if (row.revokedAt) return { success: true, message: 'این کلید پیش‌تر باطل شده بود.' };
  await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  const session = await auth();
  await logActivity(session?.user?.id, 'API_KEY_REVOKED', `کلید «${row.name}» (${row.prefix}…) ${row.user.name} باطل شد`);
  return { success: true, message: 'کلید باطل شد.' };
}
