/**
 * ERP → website: stock of the site warehouse, pushed to {site}/erp/hook
 * (docs/erp-prompt.md §4). Stock only: prices stay managed on the website.
 *
 * Database triggers (prisma/sql/pre-push-unique-columns.sql) write every stock
 * and webId change into SiteHookLog inside the writer's own transaction, so no
 * code path is missed and a rolled-back write leaves nothing. drainSiteHook
 * sends the current state of what changed, one drain at a time
 * (SiteHookLease), and deletes a log row only after the site has accepted it.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { keepAlive } from '@/lib/keep-alive';
import { WEB_ID_PATTERN } from '@/lib/web-id';
import { fetchSiteCatalogue } from '@/lib/site-catalogue';
import {
  SITE_HOOK_HOLD_KEY,
  SITE_HOOK_STATUS_KEY,
  readSiteConnection,
  type SiteConnection,
} from '@/lib/site-connection';

const ITEMS_PER_REQUEST = 100; // the site prefers batches of about 100
const LOG_ROWS_PER_PASS = 1_000;
const IDS_PER_QUERY = 10_000; // Postgres binds at most 32,767 values in one query
const HOLD_WRITE_ATTEMPTS = 5;
const ATTEMPT_TIMEOUT_MS = 30_000; // the site asks for 30 s or more
const BACKOFF_MS = [500, 1_000, 2_000]; // three retries, further apart each time
const PROBE_EVERY_MS = 10 * 60_000;
/** A delivery that would take this many frames from in stock to 0 waits for an admin. */
export const MASS_ZERO_THRESHOLD = 10;

export type SiteHookStatus = {
  lastRunAt: string | null;
  lastOkAt: string | null;
  failingSince: string | null;
  /** A configuration failure: automatic sends stop, except a probe every 10 minutes. */
  paused: { why: string; at: string; probedAt: string } | null;
  lastMessage: string | null;
};

export type SiteHookHold = {
  /** held: waiting for an admin. released: send these next, even though many go to 0 together. */
  state: 'held' | 'released';
  since: string;
  webIds: string[];
};

export type DrainResult = {
  ok: boolean;
  sent: number;
  applied: number;
  skipped: number;
  held: number;
  message: string;
};

const EMPTY_STATUS: SiteHookStatus = {
  lastRunAt: null,
  lastOkAt: null,
  failingSince: null,
  paused: null,
  lastMessage: null,
};

const nowIso = () => new Date().toISOString();

function sameSet(a: string[], b: string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && Array.from(left).every((x) => right.has(x));
}

// ── Settings rows ────────────────────────────────────────────────────────────

async function readJson<T>(key: string): Promise<T | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  try {
    return row?.value ? (JSON.parse(row.value) as T) : null;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown) {
  if (value === null) {
    await prisma.systemSetting.deleteMany({ where: { key } });
    return;
  }
  const text = JSON.stringify(value);
  await prisma.systemSetting.upsert({ where: { key }, update: { value: text }, create: { key, value: text } });
}

export async function readSiteHookStatus(): Promise<SiteHookStatus> {
  return { ...EMPTY_STATUS, ...((await readJson<SiteHookStatus>(SITE_HOOK_STATUS_KEY)) ?? {}) };
}

async function updateStatus(patch: Partial<SiteHookStatus>) {
  await writeJson(SITE_HOOK_STATUS_KEY, { ...(await readSiteHookStatus()), ...patch });
}

type HoldRow = { text: string | null; hold: SiteHookHold | null };

async function readHoldRow(): Promise<HoldRow> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SITE_HOOK_HOLD_KEY } });
  if (!row?.value) return { text: null, hold: null };
  try {
    return { text: row.value, hold: JSON.parse(row.value) as SiteHookHold };
  } catch {
    return { text: row.value, hold: null };
  }
}

/**
 * Writes the hold only if it is still exactly what was read. A release, an
 * approval and a drain acting on the hold at the same moment then cannot
 * overwrite each other and let a frame slip out of it unseen.
 */
async function casHold(read: HoldRow, next: SiteHookHold | null): Promise<boolean> {
  const key = SITE_HOOK_HOLD_KEY;
  if (read.text === null) {
    if (next === null) return true;
    const created = await prisma.systemSetting.createMany({
      data: [{ key, value: JSON.stringify(next) }],
      skipDuplicates: true,
    });
    return created.count === 1;
  }
  if (next === null) {
    return (await prisma.systemSetting.deleteMany({ where: { key, value: read.text } })).count === 1;
  }
  const updated = await prisma.systemSetting.updateMany({
    where: { key, value: read.text },
    data: { value: JSON.stringify(next) },
  });
  return updated.count === 1;
}

export async function readSiteHookHold(): Promise<SiteHookHold | null> {
  return (await readHoldRow()).hold;
}

/**
 * An admin's confirmation of the held list they were shown: those frames get
 * their current ERP count with the next drain. Refused (false) when the stored
 * hold is no longer exactly that list.
 */
export async function releaseSiteHookHold(shown: string[]): Promise<boolean> {
  const read = await readHoldRow();
  if (read.hold?.state !== 'held' || !sameSet(read.hold.webIds, shown)) return false;
  return casHold(read, { ...read.hold, state: 'released' });
}

/**
 * Frames an admin saw at 0 in a preview: the next drain sends them without
 * holding. Refused (false) while a hold waits on frames outside that list.
 */
export async function approveStockZeros(webIds: string[]): Promise<boolean> {
  const approved = new Set(webIds);
  // The list does not depend on the hold's contents: a hold that changed meanwhile is read again.
  for (let attempt = 0; attempt < HOLD_WRITE_ATTEMPTS; attempt++) {
    const read = await readHoldRow();
    const hold = read.hold;
    if (hold?.state === 'held' && hold.webIds.some((webId) => !approved.has(webId))) return false;
    if (webIds.length === 0) return true;
    const merged = new Set([...(hold?.state === 'released' ? hold.webIds : []), ...webIds]);
    if (await casHold(read, { state: 'released', since: nowIso(), webIds: Array.from(merged) })) return true;
  }
  return false;
}

/** Nothing is owed to the site while pushing is off; switching on runs a new preview. */
export async function clearSiteHookHold(): Promise<void> {
  await writeJson(SITE_HOOK_HOLD_KEY, null);
}

/** Lets automatic sends run again after the settings were fixed; the next failure is dated afresh. */
export async function clearSiteHookPause(): Promise<void> {
  const status = await readSiteHookStatus();
  if (status.paused || status.failingSince) {
    await writeJson(SITE_HOOK_STATUS_KEY, { ...status, paused: null, failingSince: null });
  }
}

// ── The lease: one drain at a time ───────────────────────────────────────────
// 90 s: longer than one 30 s attempt plus its backoff, so a request that may
// still be running on the site is never overtaken by a newer one. In UTC like
// every other time here: a session time zone with daylight saving would lock
// drains out for an hour when the clocks go back.

async function takeLease(holder: string): Promise<boolean> {
  const rows = (await prisma.$queryRaw`
    INSERT INTO "SiteHookLease" ("id", "holder", "until")
    VALUES (1, ${holder}, (now() AT TIME ZONE 'UTC') + interval '90 seconds')
    ON CONFLICT ("id") DO UPDATE SET "holder" = EXCLUDED."holder", "until" = EXCLUDED."until"
    WHERE "SiteHookLease"."until" < now() AT TIME ZONE 'UTC'
    RETURNING "id"`) as unknown[];
  return rows.length === 1;
}

async function renewLease(holder: string): Promise<boolean> {
  const count = await prisma.$executeRaw`
    UPDATE "SiteHookLease" SET "until" = (now() AT TIME ZONE 'UTC') + interval '90 seconds'
    WHERE "id" = 1 AND "holder" = ${holder}`;
  return count === 1;
}

async function releaseLease(holder: string) {
  await prisma.$executeRaw`
    UPDATE "SiteHookLease" SET "holder" = NULL, "until" = (now() AT TIME ZONE 'UTC') - interval '1 second'
    WHERE "id" = 1 AND "holder" = ${holder}`;
}

// ── What to send ─────────────────────────────────────────────────────────────

type Target = {
  webId: string;
  /** null for a retired webId: the site is told it is gone (quantity 0). */
  productId: string | null;
  rowIds: bigint[];
};

type LogRow = { id: bigint; productId: string; kind: string; warehouseId: string | null; oldWebId: string | null };

/** The saved site warehouse, only while it can still be the site's. No guessing by name. */
async function siteWarehouseId(connection: SiteConnection): Promise<string | null> {
  if (!connection.warehouseId) return null;
  const warehouse = await prisma.warehouse.findUnique({
    where: { id: connection.warehouseId },
    select: { id: true, isArchived: true, isVirtual: true },
  });
  return warehouse && !warehouse.isArchived && !warehouse.isVirtual ? warehouse.id : null;
}

/**
 * Turns log rows into one target per webId. A count changed in another
 * warehouse is not the site's business, and would only repeat a state the
 * site may already have moved past (a unit it sold but the ERP has not yet
 * recorded), so it is not sent.
 */
async function planTargets(rows: LogRow[], warehouseId: string) {
  const productIds = Array.from(new Set(rows.map((row) => row.productId)));
  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, webId: true } });
  const webIdOf = new Map<string, string | null>(products.map((p: any) => [p.id, p.webId]));
  const retired = Array.from(new Set(rows.map((row) => row.oldWebId).filter((id): id is string => !!id)));
  const stillUsed = new Set<string>(
    retired.length
      ? (await prisma.product.findMany({ where: { webId: { in: retired } }, select: { webId: true } })).map((p: any) => p.webId)
      : [],
  );

  const targets = new Map<string, Target>();
  const discard: bigint[] = [];
  for (const row of rows) {
    let webId: string | null = null;
    let productId: string | null = null;
    if (row.kind === 'retire') {
      if (row.oldWebId && !stillUsed.has(row.oldWebId)) webId = row.oldWebId;
    } else if (row.kind !== 'stock' || row.warehouseId === warehouseId) {
      webId = webIdOf.get(row.productId) ?? null;
      productId = row.productId;
    }
    if (!webId || !WEB_ID_PATTERN.test(webId)) {
      discard.push(row.id);
      continue;
    }
    const target = targets.get(webId) ?? { webId, productId, rowIds: [] };
    if (productId) target.productId = productId;
    target.rowIds.push(row.id);
    targets.set(webId, target);
  }
  return { targets: Array.from(targets.values()), discard };
}

/**
 * Every frame still owed, over the whole log. One write's rows can lie on both
 * sides of a pass, or commit after a pass has read past some of them; counted
 * over the whole log, a mass zero is still seen as one.
 */
async function pendingTargets(warehouseId: string): Promise<Target[]> {
  const rows = (await prisma.$queryRaw`
    SELECT DISTINCT ON ("productId", "kind", "warehouseId", "oldWebId")
      "id", "productId", "kind", "warehouseId", "oldWebId"
    FROM "SiteHookLog"
    ORDER BY "productId", "kind", "warehouseId", "oldWebId", "id"`) as LogRow[];
  return (await planTargets(rows, warehouseId)).targets;
}

/** Quantities as they are right now, never below 0. */
async function currentQuantities(targets: Target[], warehouseId: string): Promise<Map<string, number>> {
  const productIds = targets.map((t) => t.productId).filter((id): id is string => !!id);
  const byProduct = new Map<string, number>();
  for (let i = 0; i < productIds.length; i += IDS_PER_QUERY) {
    const rows = await prisma.inventory.findMany({
      where: { warehouseId, productId: { in: productIds.slice(i, i + IDS_PER_QUERY) } },
      select: { productId: true, quantity: true },
    });
    for (const row of rows as Array<{ productId: string; quantity: number }>) byProduct.set(row.productId, row.quantity);
  }
  return new Map(targets.map((t) => [t.webId, Math.max(0, t.productId ? byProduct.get(t.productId) ?? 0 : 0)]));
}

async function deleteRows(ids: bigint[]) {
  // Exact ids only: a lower id can commit after a higher one was read, so a
  // range would delete a change that was never sent.
  for (let i = 0; i < ids.length; i += 1_000) {
    await prisma.siteHookLog.deleteMany({ where: { id: { in: ids.slice(i, i + 1_000) } } });
  }
}

/**
 * Which frames of this pass must wait, decided over every frame still owed.
 * Many frames going to 0 at once wait for an admin; a real sale of one frame
 * never does. A held frame waits while it is still at 0. A new mass zero is
 * written into the hold before anything is sent: if an admin changed the hold
 * meanwhile, it is read again and decided again. null when it kept changing,
 * so nothing is sent on a decision that was not recorded.
 */
async function holdBack(targets: Target[], warehouseId: string) {
  const pending = await pendingTargets(warehouseId);
  const pendingIds = new Set(pending.map((t) => t.webId));
  // A target whose webId changed after this pass read its rows is counted too.
  const scope = [...pending, ...targets.filter((t) => !pendingIds.has(t.webId))];
  const checked = await currentQuantities(scope, warehouseId);
  const atZero = scope.filter((t) => checked.get(t.webId) === 0).map((t) => t.webId);
  const last = atZero.length
    ? await prisma.siteHookState.findMany({ where: { webId: { in: atZero } }, select: { webId: true, quantity: true } })
    : [];
  const lastQuantity = new Map<string, number | null>(last.map((s: any) => [s.webId, s.quantity]));

  for (let attempt = 0; attempt < HOLD_WRITE_ATTEMPTS; attempt++) {
    const read = await readHoldRow();
    const hold = read.hold;
    const storedHeld = new Set(hold?.state === 'held' ? hold.webIds : []);
    const released = new Set(hold?.state === 'released' ? hold.webIds : []);
    // Fixed in the ERP, a held frame goes out like any other.
    const stillHeld = atZero.filter((webId) => storedHeld.has(webId));
    const goingOut = atZero.filter((webId) => {
      if (storedHeld.has(webId) || released.has(webId)) return false;
      const was = lastQuantity.get(webId);
      // Never accepted by the site: it may well show the frame in stock.
      return was == null || was > 0;
    });
    const hidden = new Set(stillHeld);
    if (goingOut.length < MASS_ZERO_THRESHOLD) return { checked, released, hidden };

    const scopeIds = new Set(scope.map((t) => t.webId));
    const untouched = Array.from(storedHeld).filter((webId) => !scopeIds.has(webId));
    const written = await casHold(read, {
      state: 'held',
      since: hold?.state === 'held' ? hold.since : nowIso(),
      webIds: Array.from(new Set([...untouched, ...stillHeld, ...goingOut])),
    });
    if (written) {
      for (const webId of goingOut) hidden.add(webId);
      return { checked, released, hidden };
    }
  }
  return null;
}

// ── Delivery ─────────────────────────────────────────────────────────────────

type Delivery =
  | { kind: 'accepted'; applied: number; skipped: Array<{ key: string; why: string }> }
  | { kind: 'config'; why: string } // fix the settings or the site; do not retry
  | { kind: 'transient'; why: string } // the site did not get it; retrying is safe
  | { kind: 'unknown'; why: string }; // it may have landed; send nothing newer for a while

function signed(secret: string, body: string) {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

async function postOnce(url: string, secret: string, body: string): Promise<Delivery> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      // The signature alone: the site checks only one of the two when both are sent.
      headers: { 'content-type': 'application/json', 'x-erp-signature': signed(secret, body) },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
    });
  } catch (error: any) {
    const code = error?.cause?.code ?? error?.code ?? '';
    // Node reports a refused redirect only in cause.message ("unexpected redirect").
    const text = `${error?.name ?? ''} ${error?.message ?? ''} ${error?.cause?.message ?? ''} ${code}`;
    if (/redirect/i.test(text)) return { kind: 'config', why: 'آدرس وبهوک سایت ریدایرکت می‌شود.' };
    // Refused before anything was sent: the site did not get the request.
    if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|CERT|SSL|TLS/i.test(text)) {
      return { kind: 'transient', why: `به سایت وصل نشد (${code || error?.name}).` };
    }
    return { kind: 'unknown', why: `پاسخ سایت نرسید (${code || error?.name || 'timeout'}).` };
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch (error) {
    // A body cut off mid-read may belong to an accepted delivery.
    if (res.ok && !(error instanceof SyntaxError)) return { kind: 'unknown', why: `پاسخ ${res.status} سایت کامل نرسید.` };
    json = null;
  }
  if (res.ok) {
    if (!json || json.ok !== true || typeof json.applied !== 'number') {
      return { kind: 'config', why: `پاسخ ${res.status} سایت قالب قرارداد را ندارد؛ آدرس سایت درست است؟` };
    }
    if (json.ignored) {
      // The site holds it for a reason of its own: its warehouse, its stock pull or its sale recording.
      return {
        kind: 'config',
        why: `سایت ارسال را نگه داشت (${String(json.ignored).slice(0, 200)})؛ انبار سایت و روشن بودن دریافت موجودی و «ثبت سفارش در ERP» را در پنل سایت بررسی کنید.`,
      };
    }
    const skipped = Array.isArray(json.skipped)
      ? json.skipped.filter((s: any) => typeof s?.key === 'string').map((s: any) => ({ key: s.key, why: String(s.why ?? '') }))
      : [];
    return { kind: 'accepted', applied: json.applied, skipped };
  }
  const why = typeof json?.why === 'string' ? `: ${json.why}` : '';
  if (res.status === 401) return { kind: 'config', why: 'سایت رمز وبهوک را نپذیرفت؛ رمز دو طرف یکی نیست.' };
  // Only the site's own 503 is a setting; a proxy's 503 while the site restarts is temporary.
  if (res.status === 503 && json?.ok === false && typeof json?.why === 'string') {
    return { kind: 'config', why: `سایت اتصال ERP را خاموش گزارش کرد${why}.` };
  }
  if (res.status === 422) return { kind: 'config', why: `سایت بدنهٔ ارسال را نپذیرفت (422)${why}.` };
  if ([408, 429, 500, 501, 503].includes(res.status)) return { kind: 'transient', why: `خطای موقت سایت (${res.status}).` };
  if (res.status === 502 || res.status === 504) return { kind: 'unknown', why: `پاسخ سایت نامعلوم ماند (${res.status}).` };
  if (res.status >= 500) return { kind: 'transient', why: `خطای سایت (${res.status}).` };
  return { kind: 'config', why: `سایت درخواست را نپذیرفت (${res.status})؛ آدرس سایت درست است؟` };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One batch, rebuilt from current stock before every attempt. A frame that
 * went to 0 after the hold check is left out and stays in the log, so a later
 * pass counts it together with any others going out at the same time.
 */
async function deliver(
  connection: SiteConnection,
  warehouseId: string,
  batch: Target[],
  checked: Map<string, number>,
  released: Set<string>,
  deadline: number,
): Promise<{ delivery: Delivery | null; sent: Target[]; items: Array<{ webId: string; quantity: number }> }> {
  for (let attempt = 0; ; attempt++) {
    // Stamped before reading: the site keeps the newest reading by `at`, so a
    // reading must never carry a time later than the moment it was taken.
    const at = nowIso();
    const quantities = await currentQuantities(batch, warehouseId);
    const sent = batch.filter(
      (t) => !(quantities.get(t.webId) === 0 && (checked.get(t.webId) ?? 0) > 0 && !released.has(t.webId)),
    );
    if (sent.length === 0) return { delivery: null, sent, items: [] };
    const items = sent.map((t) => ({ webId: t.webId, quantity: quantities.get(t.webId) ?? 0 }));
    const body = JSON.stringify({ event: 'stock.changed', warehouseId, at, eventId: randomUUID(), items });
    const delivery = await postOnce(`${connection.siteUrl}/erp/hook`, connection.webhookSecret as string, body);
    const backoff = BACKOFF_MS[attempt];
    if (delivery.kind !== 'transient' || backoff === undefined || Date.now() + backoff >= deadline) {
      return { delivery, sent, items };
    }
    await sleep(backoff);
  }
}

/**
 * Deletes the delivered rows and records what the site took, in one
 * transaction: a function cut short leaves either the rows (sent again,
 * harmlessly) or rows and state together, never rows gone with state stale.
 */
async function recordAccepted(
  sent: Target[],
  items: Array<{ webId: string; quantity: number }>,
  skipped: Array<{ key: string; why: string }>,
) {
  const skippedWhy = new Map(skipped.map((s) => [s.key, s.why]));
  const accepted = items.filter((item) => !skippedWhy.has(item.webId));
  const refused = items.filter((item) => skippedWhy.has(item.webId));
  // In UTC whatever the database session's time zone: Prisma reads these columns as UTC.
  const at = nowIso();
  await prisma.$transaction(async (tx: any) => {
    await tx.siteHookLog.deleteMany({ where: { id: { in: sent.flatMap((t) => t.rowIds) } } });
    if (accepted.length > 0) {
      await tx.$executeRaw`
        INSERT INTO "SiteHookState" ("webId", "quantity", "sentAt")
        SELECT w, q, (${at}::timestamptz AT TIME ZONE 'UTC')::timestamp(3)
        FROM unnest(${accepted.map((i) => i.webId)}::text[], ${accepted.map((i) => i.quantity)}::int[]) AS t(w, q)
        ON CONFLICT ("webId") DO UPDATE
        SET "quantity" = EXCLUDED."quantity", "sentAt" = EXCLUDED."sentAt", "skipWhy" = NULL, "skipAt" = NULL`;
    }
    if (refused.length > 0) {
      // A refused item keeps its last accepted quantity; its reason stays until it is accepted.
      await tx.$executeRaw`
        INSERT INTO "SiteHookState" ("webId", "skipWhy", "skipAt")
        SELECT w, y, (${at}::timestamptz AT TIME ZONE 'UTC')::timestamp(3)
        FROM unnest(${refused.map((i) => i.webId)}::text[], ${refused.map((i) => skippedWhy.get(i.webId) || 'نامشخص')}::text[]) AS t(w, y)
        ON CONFLICT ("webId") DO UPDATE SET "skipWhy" = EXCLUDED."skipWhy", "skipAt" = EXCLUDED."skipAt"`;
    }
  });
}

/** Delivered frames leave the hold, whether it was still held or already released. */
async function pruneHold(items: Array<{ webId: string }>) {
  const delivered = new Set(items.map((item) => item.webId));
  for (let attempt = 0; attempt < HOLD_WRITE_ATTEMPTS; attempt++) {
    const read = await readHoldRow();
    if (!read.hold) return;
    const left = read.hold.webIds.filter((webId) => !delivered.has(webId));
    if (left.length === read.hold.webIds.length) return;
    if (await casHold(read, left.length ? { ...read.hold, webIds: left } : null)) return;
  }
}

// ── The drain ────────────────────────────────────────────────────────────────

type PassOutcome = 'more' | 'done' | 'stopped' | 'unknown';

async function pause(why: string) {
  const at = nowIso();
  const status = await readSiteHookStatus();
  await writeJson(SITE_HOOK_STATUS_KEY, {
    ...status,
    lastRunAt: at,
    lastMessage: why,
    failingSince: status.failingSince ?? at,
    paused: { why, at: status.paused?.at ?? at, probedAt: at },
  });
}

async function drainPass(
  holder: string,
  deadline: number,
  cursor: bigint,
  result: DrainResult,
): Promise<{ outcome: PassOutcome; cursor: bigint }> {
  const rows = (await prisma.siteHookLog.findMany({
    where: { id: { gt: cursor } },
    orderBy: { id: 'asc' },
    take: LOG_ROWS_PER_PASS,
    select: { id: true, productId: true, kind: true, warehouseId: true, oldWebId: true },
  })) as LogRow[];
  if (rows.length === 0) return { outcome: 'done', cursor };
  const nextCursor = rows[rows.length - 1].id;

  const connection = await readSiteConnection(prisma);
  if (!connection.stockPushEnabled) {
    // Nothing is owed while pushing is off: switching it on sends everything.
    await deleteRows(rows.map((row) => row.id));
    return { outcome: 'more', cursor: nextCursor };
  }

  const status = await readSiteHookStatus();
  if (status.paused && Date.now() - Date.parse(status.paused.probedAt) < PROBE_EVERY_MS) {
    result.ok = false;
    result.message = status.paused.why;
    return { outcome: 'stopped', cursor };
  }
  const warehouseId = await siteWarehouseId(connection);
  if (!connection.siteUrl || !connection.webhookSecret || !warehouseId) {
    const why = 'آدرس سایت، رمز وبهوک یا انبار سایت در «تنظیمات › اتصال سایت» معتبر نیست.';
    await pause(why);
    result.ok = false;
    result.message = why;
    return { outcome: 'stopped', cursor };
  }
  if (status.paused) await updateStatus({ paused: { ...status.paused, probedAt: nowIso() } });

  const { targets, discard } = await planTargets(rows, warehouseId);
  await deleteRows(discard);
  if (targets.length === 0) return { outcome: 'more', cursor: nextCursor };

  const decision = await holdBack(targets, warehouseId);
  if (!decision) {
    result.message = 'فهرست نگه‌داشته‌ها هم‌زمان تغییر کرد؛ ارسال بعدی دوباره تصمیم می‌گیرد.';
    return { outcome: 'stopped', cursor };
  }
  const { checked, released, hidden } = decision;
  const sendable = targets.filter((t) => !hidden.has(t.webId));
  result.held += targets.length - sendable.length;

  for (let i = 0; i < sendable.length; i += ITEMS_PER_REQUEST) {
    if (Date.now() >= deadline || !(await renewLease(holder))) return { outcome: 'stopped', cursor };
    const batch = sendable.slice(i, i + ITEMS_PER_REQUEST);
    const { delivery, sent, items } = await deliver(connection, warehouseId, batch, checked, released, deadline);
    if (!delivery) continue; // all of it went to 0 after the check: left for a later pass

    if (delivery.kind !== 'accepted') {
      result.ok = false;
      result.message = delivery.why;
      if (delivery.kind === 'config') {
        await pause(delivery.why);
        return { outcome: 'stopped', cursor };
      }
      const failed = await readSiteHookStatus();
      await updateStatus({ lastRunAt: nowIso(), lastMessage: delivery.why, failingSince: failed.failingSince ?? nowIso() });
      return { outcome: delivery.kind === 'unknown' ? 'unknown' : 'stopped', cursor };
    }

    await recordAccepted(sent, items, delivery.skipped);
    await pruneHold(items);
    result.sent += items.length;
    result.applied += delivery.applied;
    result.skipped += delivery.skipped.length;
    await updateStatus({
      lastRunAt: nowIso(),
      lastOkAt: nowIso(),
      failingSince: null,
      paused: null,
      lastMessage: delivery.skipped.length
        ? `سایت ${delivery.skipped.length.toLocaleString('fa-IR')} قلم را نپذیرفت.`
        : null,
    });
  }
  return { outcome: 'more', cursor: nextCursor };
}

/**
 * Sends what changed until nothing is left or the deadline passes. No send
 * starts after the deadline; one already running may take up to 30 s more.
 * Never throws.
 */
export async function drainSiteHook({ deadlineMs = 25_000 }: { deadlineMs?: number } = {}): Promise<DrainResult> {
  const deadline = Date.now() + deadlineMs;
  const result: DrainResult = { ok: true, sent: 0, applied: 0, skipped: 0, held: 0, message: '' };
  const holder = randomUUID();
  try {
    if (!(await takeLease(holder))) return { ...result, message: 'ارسال دیگری در جریان است.' };
  } catch (error) {
    return { ...result, ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  let outcome: PassOutcome = 'more';
  let cursor = BigInt(0);
  try {
    while (outcome === 'more' && Date.now() < deadline) {
      ({ outcome, cursor } = await drainPass(holder, deadline, cursor, result));
    }
  } catch (error) {
    result.ok = false;
    result.message = error instanceof Error ? error.message : String(error);
    // A drain that fails every run must still show up as failing.
    const failed = await readSiteHookStatus().catch(() => null);
    await updateStatus({
      lastRunAt: nowIso(),
      lastMessage: result.message,
      failingSince: failed?.failingSince ?? nowIso(),
    }).catch(() => undefined);
  } finally {
    // After an unknown outcome the lease runs out on its own, so nothing newer
    // reaches the site before the request that may still be running there.
    if (outcome !== 'unknown') await releaseLease(holder).catch(() => undefined);
  }

  // A change that committed after the last read, while this drain still held
  // the lease, would otherwise wait for the next scheduled run.
  if (outcome === 'done' && Date.now() < deadline) {
    const newer = await prisma.siteHookLog.findFirst({ where: { id: { gt: cursor } }, select: { id: true } }).catch(() => null);
    if (newer) {
      const more = await drainSiteHook({ deadlineMs: deadline - Date.now() });
      return {
        ok: result.ok && more.ok,
        sent: result.sent + more.sent,
        applied: result.applied + more.applied,
        skipped: result.skipped + more.skipped,
        held: result.held + more.held,
        message: more.message || result.message,
      };
    }
  }
  return result;
}

/** After a stock change commits: deliver in the background on production. Never waits, never throws. */
export function kickSiteHook(): void {
  if (process.env.VERCEL_ENV !== 'production') return;
  keepAlive(drainSiteHook({ deadlineMs: 20_000 }).catch(() => undefined));
}

/** Everything with a webId, sent again with the next drain (switching on, a new site warehouse, the resync button). */
export async function enqueueFullResync(): Promise<number> {
  // createdAt in UTC explicitly: CURRENT_TIMESTAMP follows the session's time zone.
  return prisma.$executeRaw`
    INSERT INTO "SiteHookLog" ("productId", "kind", "createdAt")
    SELECT "id", 'resync', now() AT TIME ZONE 'UTC' FROM "Product" WHERE "webId" IS NOT NULL`;
}

/** Asks the site which warehouse it takes stock for. Checks the secret, changes nothing. */
export async function pingSite(
  connection: Pick<SiteConnection, 'siteUrl' | 'webhookSecret'>,
): Promise<{ ok: true; warehouse: string | null } | { ok: false; message: string }> {
  if (!connection.siteUrl || !connection.webhookSecret) {
    return { ok: false, message: 'اول آدرس سایت و رمز وبهوک را ذخیره کنید.' };
  }
  const body = '{}';
  try {
    const res = await fetch(`${connection.siteUrl}/erp/ping`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-erp-signature': signed(connection.webhookSecret, body) },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    const json: any = await res.json().catch(() => null);
    if (res.status === 401) return { ok: false, message: 'سایت رمز وبهوک را نپذیرفت؛ رمز دو طرف یکی نیست.' };
    if (res.status === 503) return { ok: false, message: `سایت رمز وبهوک ندارد${json?.why ? `: ${json.why}` : ''}.` };
    if (!res.ok || json?.ok !== true) {
      return { ok: false, message: `سایت به /erp/ping جواب درست نداد (${res.status})؛ سایت روی این آدرس است؟` };
    }
    return { ok: true, warehouse: typeof json.warehouse === 'string' && json.warehouse ? json.warehouse : null };
  } catch (error: any) {
    if (/redirect/i.test(String(error?.cause?.message ?? ''))) {
      return { ok: false, message: 'آدرس سایت ریدایرکت می‌شود؛ آدرس نهایی را در تنظیمات وارد کنید.' };
    }
    return { ok: false, message: `به سایت وصل نشد (${error?.cause?.code ?? error?.name ?? 'خطای شبکه'}).` };
  }
}

export type StockPushPreview =
  | { ok: false; message: string }
  | {
      ok: true;
      warehouseId: string;
      /** In stock on the site now, or of unknown stock there, and 0 in the ERP's site warehouse: these would go out of stock. */
      goingOut: string[];
      /** Out of stock on the site now, in stock in the ERP: these would come back. */
      comingIn: string[];
      unchanged: number;
      /** The ERP has the webId; the site's catalogue does not list it. */
      notOnSite: string[];
      /** At 0 in the ERP and already out on the site, or not listed there: sent as 0 without a hold. */
      zeros: string[];
    };

/** What switching on, or a full resync, would change on the site, read from its catalogue. Writes nothing. */
export async function previewStockPush(connection: SiteConnection): Promise<StockPushPreview> {
  const warehouseId = await siteWarehouseId(connection);
  if (!warehouseId) {
    return {
      ok: false,
      message: 'انبار سایت را در «تنظیمات › اتصال سایت» ذخیره کنید؛ انبار بایگانی‌شده یا امانی قابل استفاده نیست.',
    };
  }
  if (!connection.siteUrl || !connection.webhookSecret) {
    return { ok: false, message: 'اول آدرس سایت و رمز وبهوک را ذخیره کنید.' };
  }
  const catalogue = await fetchSiteCatalogue({ siteUrl: connection.siteUrl, secret: connection.webhookSecret });
  if (!catalogue.ok) return { ok: false, message: catalogue.message };
  const onSite = new Map(catalogue.items.map((item) => [item.webId, item.inStock ?? null]));

  const products = (await prisma.product.findMany({
    where: { webId: { not: null } },
    select: { id: true, webId: true },
  })) as Array<{ id: string; webId: string }>;
  const rows = await prisma.inventory.findMany({
    where: { warehouseId, productId: { in: products.map((p) => p.id) } },
    select: { productId: true, quantity: true },
  });
  const quantity = new Map<string, number>(rows.map((r: any) => [r.productId, r.quantity]));

  const goingOut: string[] = [];
  const comingIn: string[] = [];
  const notOnSite: string[] = [];
  const zeros: string[] = [];
  let unchanged = 0;
  for (const product of products) {
    const inStockHere = (quantity.get(product.id) ?? 0) > 0;
    if (!onSite.has(product.webId)) {
      notOnSite.push(product.webId);
      if (!inStockHere) zeros.push(product.webId);
      continue;
    }
    const inStockThere = onSite.get(product.webId);
    // Unknown on the site counts as in stock there: the admin must see it go.
    if (inStockThere !== false && !inStockHere) goingOut.push(product.webId);
    else if (inStockThere === false && !inStockHere) {
      zeros.push(product.webId);
      unchanged++;
    } else if (inStockThere === false && inStockHere) comingIn.push(product.webId);
    else unchanged++;
  }
  return { ok: true, warehouseId, goingOut, comingIn, unchanged, notOnSite, zeros };
}
