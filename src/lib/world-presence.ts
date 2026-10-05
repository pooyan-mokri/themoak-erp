/**
 * Who else is in the business world right now (/dashboard/world): each open
 * world reports its figure's place every few seconds and gets everyone else's.
 * Kept in this server's memory only — the ERP runs as one process
 * (docs/deploy-liara.md) — and forgotten 20 s after the last report, so a
 * closed tab leaves within seconds and a restart simply starts empty.
 */

export const PRESENCE_TTL_MS = 20_000;
/** Reports closer together than this are taken as one: no client needs more. */
export const PRESENCE_MIN_GAP_MS = 1_000;

export type Presence = {
  userId: string;
  name: string;
  role: string;
  x: number;
  z: number;
  yaw: number;
  district: string | null;
  at: number;
};

const LIMIT = 400;
const DISTRICT = /^[a-z]{2,16}$/;

export class PresenceBoard {
  private seen = new Map<string, Presence>();

  /** Records a report, or null when it is not a sane one. */
  report(user: { id: string; name: string; role: string }, input: unknown, now: number = Date.now()): Presence | null {
    const body = (input ?? {}) as Record<string, unknown>;
    const x = Number(body.x);
    const z = Number(body.z);
    const yaw = Number(body.yaw ?? 0);
    if (![x, z, yaw].every(Number.isFinite) || Math.abs(x) > LIMIT || Math.abs(z) > LIMIT) return null;
    const district = typeof body.district === 'string' && DISTRICT.test(body.district) ? body.district : null;
    const last = this.seen.get(user.id);
    if (last && now - last.at < PRESENCE_MIN_GAP_MS) return last;
    const entry: Presence = { userId: user.id, name: user.name, role: user.role, x, z, yaw, district, at: now };
    this.seen.set(user.id, entry);
    return entry;
  }

  /** Everyone seen within the last 20 s except the asker, freshest first. */
  others(userId: string, now: number = Date.now()): Presence[] {
    for (const [id, p] of this.seen) if (now - p.at > PRESENCE_TTL_MS) this.seen.delete(id);
    return [...this.seen.values()].filter((p) => p.userId !== userId).sort((a, b) => b.at - a.at);
  }

  leave(userId: string) {
    this.seen.delete(userId);
  }
}

// One board per server process, kept across hot reloads in development.
const holder = globalThis as unknown as { __worldPresence?: PresenceBoard };
export const presenceBoard = (holder.__worldPresence ??= new PresenceBoard());
