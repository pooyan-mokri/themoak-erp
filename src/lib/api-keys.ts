import { createHash, randomBytes } from 'node:crypto';
import type { ApiActor } from '@/lib/api-actor';

/**
 * Personal keys for the ERP API (/api/erp), one or more per user, for Claude's
 * ERP connector. A key is «tmk_» and 43 random characters; only its SHA-256 is
 * stored, with its first characters to tell keys apart. A call with a key acts
 * as its user (src/lib/api-actor.ts): their role decides what it may do, and
 * what it records carries their name. Revoking a key, deactivating its user or
 * deleting them ends it at once.
 */

export const API_KEY_PREFIX = 'tmk_';
const KEY_SHAPE = /^tmk_[A-Za-z0-9_-]{43}$/;
/** lastUsedAt is written at most this often, not on every call. */
const TOUCH_EVERY_MS = 5 * 60_000;

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function newApiKey(): { key: string; prefix: string; hash: string } {
  const key = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { key, prefix: key.slice(0, 8), hash: hashApiKey(key) };
}

export function looksLikeApiKey(value: string): boolean {
  return KEY_SHAPE.test(value);
}

/** The user a key belongs to, or null for an unknown, revoked or ended key. `client` is a Prisma client. */
export async function apiKeyUser(client: any, key: string, now: Date = new Date()): Promise<ApiActor | null> {
  if (!looksLikeApiKey(key)) return null;
  const row = await client.apiKey.findUnique({
    where: { hash: hashApiKey(key) },
    select: { id: true, revokedAt: true, lastUsedAt: true, user: { select: { id: true, name: true, email: true, role: true, isActive: true } } },
  });
  if (!row || row.revokedAt || !row.user?.isActive) return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    await client.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: now } }).catch(() => {});
  }
  return { id: row.user.id, name: row.user.name, email: row.user.email, role: row.user.role };
}

/** The tag a record made through a personal key carries, so the list shows who made it. */
export function apiTag(actor: Pick<ApiActor, 'name'>): string {
  return `Claude · ${actor.name}`;
}
