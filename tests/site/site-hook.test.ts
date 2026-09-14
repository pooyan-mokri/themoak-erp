import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import {
  MASS_ZERO_THRESHOLD,
  type DrainResult,
  approveStockZeros,
  clearSiteHookPause,
  drainSiteHook,
  enqueueFullResync,
  pingSite,
  previewStockPush,
  readSiteHookHold,
  readSiteHookStatus,
  releaseSiteHookHold,
} from '@/lib/site-hook';
import { SITE_CONNECTION_KEY, SITE_HOOK_HOLD_KEY, SITE_HOOK_STATUS_KEY, readSiteConnection } from '@/lib/site-connection';
import { GET as flushGET, POST as flushPOST } from '@/app/api/site/hook-flush/route';
import { issueAdjustmentDocuments } from '@/actions/inventory-audit';

const SECRET = 'site-webhook-secret';
const SITE_WH = 'wh-site';
const MAIN_WH = 'wh-main';
const BUSY = /در جریان/;

type Seen = { url: string; method: string; headers: IncomingHttpHeaders; raw: Buffer; body: any };
type Answer = { status?: number; json?: unknown; html?: string; headers?: Record<string, string>; delayMs?: number };
type FakeSite = { url: string; seen: Seen[]; answer: (req: Seen, n: number) => Answer };

const servers: Array<() => Promise<void>> = [];

beforeEach(async () => {
  beforeQuery.fn = null;
  setTestRole('ADMIN');
  await resetDatabase();
  await prisma.warehouse.createMany({
    data: [
      { id: SITE_WH, name: 'مشاهیر' },
      { id: MAIN_WH, name: 'انبار مرکزی' },
    ],
  });
});
after(async () => {
  for (const close of servers) await close();
  await prisma.$disconnect();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The site's answer to a delivery it applied in full. */
function accept(req: Seen): Answer {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  return { json: { ok: true, read: items.length, applied: items.length, skipped: [], changes: [] } };
}

/**
 * A stand-in for the website on a random local port. It keeps every request
 * with its raw bytes; `site.answer` decides each reply and can be swapped mid-test.
 */
async function fakeSite(answer: FakeSite['answer'] = accept): Promise<FakeSite> {
  const site: FakeSite = { url: '', seen: [], answer };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks);
      let body: any = null;
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        body = null;
      }
      const seen: Seen = { url: req.url ?? '', method: req.method ?? '', headers: req.headers, raw, body };
      site.seen.push(seen);
      const reply = site.answer(seen, site.seen.length);
      if (reply.delayMs) await sleep(reply.delayMs);
      if (reply.html !== undefined) {
        res.writeHead(reply.status ?? 200, { 'content-type': 'text/html', ...reply.headers }).end(reply.html);
      } else {
        res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...reply.headers }).end(JSON.stringify(reply.json ?? {}));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  site.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return site;
}

async function connect(siteUrl: string, patch: Record<string, unknown> = {}) {
  const value = JSON.stringify({
    siteUrl,
    webhookSecret: SECRET,
    paymentAccountId: null,
    warehouseId: SITE_WH,
    stockPushEnabled: true,
    ...patch,
  });
  await prisma.systemSetting.upsert({ where: { key: SITE_CONNECTION_KEY }, update: { value }, create: { key: SITE_CONNECTION_KEY, value } });
}

/** A product and its counts in the site warehouse and the main one. */
async function frame(id: string, webId: string | null, stock: { site?: number; main?: number } = {}) {
  await prisma.product.create({ data: { id, name: id, sku: id.toUpperCase(), costPrice: 1, sellPrice: 15_700_000, webId } });
  const rows: Array<{ productId: string; warehouseId: string; quantity: number }> = [];
  if (stock.site !== undefined) rows.push({ productId: id, warehouseId: SITE_WH, quantity: stock.site });
  if (stock.main !== undefined) rows.push({ productId: id, warehouseId: MAIN_WH, quantity: stock.main });
  if (rows.length) await prisma.inventory.createMany({ data: rows });
}

const setStock = (productId: string, quantity: number, warehouseId = SITE_WH) =>
  prisma.inventory.update({ where: { productId_warehouseId: { productId, warehouseId } }, data: { quantity } });

/** What the site was told, webId → quantity, in the requests from index `from` on. */
function sent(site: FakeSite, from = 0): Record<string, number> {
  return Object.fromEntries(
    site.seen.slice(from).flatMap((req) => (req.body?.items ?? []).map((item: any) => [item.webId, item.quantity])),
  );
}

/** The last quantity the site accepted, per webId. */
async function states(): Promise<Record<string, number | null>> {
  return Object.fromEntries((await prisma.siteHookState.findMany()).map((s: any) => [s.webId, s.quantity]));
}

const signature = (data: Buffer | string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(data).digest('hex')}`;

// ── Triggers ────────────────────────────────────────────────────────────────

test('the triggers log stock and webId changes, and nothing for a price, the same count or a rolled-back write', async () => {
  const triggers = (await prisma.$queryRawUnsafe(
    `SELECT tgname, tgrelid::regclass::text AS "table" FROM pg_trigger
     WHERE tgname IN ('site_hook_product', 'site_hook_inventory') ORDER BY tgname`,
  )) as Array<{ tgname: string; table: string }>;
  assert.deepEqual(triggers, [
    { tgname: 'site_hook_inventory', table: '"Inventory"' },
    { tgname: 'site_hook_product', table: '"Product"' },
  ]);

  let read = 0;
  const newRows = async () => {
    const rows = await prisma.siteHookLog.findMany({
      orderBy: { id: 'asc' },
      select: { productId: true, kind: true, warehouseId: true, oldWebId: true },
    });
    const fresh = rows.slice(read);
    read = rows.length;
    return fresh;
  };
  const stock = (warehouseId: string) => ({ productId: 'p', kind: 'stock', warehouseId, oldWebId: null });
  const webid = { productId: 'p', kind: 'webid', warehouseId: null, oldWebId: null };
  const retire = (oldWebId: string) => ({ productId: 'p', kind: 'retire', warehouseId: null, oldWebId });

  await frame('p', null);
  assert.deepEqual(await newRows(), [], 'a product without a webId and without stock');

  await prisma.inventory.create({ data: { productId: 'p', warehouseId: SITE_WH, quantity: 3 } });
  assert.deepEqual(await newRows(), [stock(SITE_WH)], 'insert');
  await prisma.inventory.update({ where: { productId_warehouseId: { productId: 'p', warehouseId: SITE_WH } }, data: { quantity: { increment: 2 } } });
  assert.deepEqual(await newRows(), [stock(SITE_WH)], 'quantity change');
  await setStock('p', 5);
  assert.deepEqual(await newRows(), [], 'an update to the same quantity');
  await prisma.product.update({ where: { id: 'p' }, data: { sellPrice: 18_500_000, costPrice: 9 } });
  assert.deepEqual(await newRows(), [], 'prices are not logged');

  await prisma.inventory.create({ data: { productId: 'p', warehouseId: MAIN_WH, quantity: 1 } });
  await prisma.inventory.delete({ where: { productId_warehouseId: { productId: 'p', warehouseId: MAIN_WH } } });
  assert.deepEqual(await newRows(), [stock(MAIN_WH), stock(MAIN_WH)], 'insert and delete, with their warehouse');

  await prisma.product.update({ where: { id: 'p' }, data: { webId: 'MOAK-PANJ-BLUE' } });
  assert.deepEqual(await newRows(), [webid], 'webId set');
  await prisma.product.update({ where: { id: 'p' }, data: { webId: 'MOAK-PANJ-NAVY' } });
  assert.deepEqual(await newRows(), [retire('MOAK-PANJ-BLUE'), webid], 'webId changed');
  await prisma.product.update({ where: { id: 'p' }, data: { webId: null } });
  assert.deepEqual(await newRows(), [retire('MOAK-PANJ-NAVY')], 'webId cleared');

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await tx.inventory.update({ where: { productId_warehouseId: { productId: 'p', warehouseId: SITE_WH } }, data: { quantity: 9 } });
      await tx.product.update({ where: { id: 'p' }, data: { webId: 'MOAK-PANJ-RED' } });
      throw new Error('rolled back');
    }),
    /rolled back/,
  );
  assert.deepEqual(await newRows(), [], 'a rolled-back write leaves nothing');
  assert.equal((await prisma.inventory.findUniqueOrThrow({ where: { productId_warehouseId: { productId: 'p', warehouseId: SITE_WH } } })).quantity, 5);
});

// ── What a drain sends ──────────────────────────────────────────────────────

test('a drain sends the site warehouse stock of frames with a webId, signed over the raw bytes, at most 100 per request', async () => {
  const site = await fakeSite();
  await connect(site.url);
  const expected: Record<string, number> = {};
  const products = [];
  const inventory = [];
  for (let i = 0; i < 101; i++) {
    products.push({ id: `f${i}`, name: `F${i}`, sku: `F${i}`, costPrice: 1, sellPrice: 15_700_000, webId: `MOAK-F${i}` });
    inventory.push({ productId: `f${i}`, warehouseId: SITE_WH, quantity: i % 4 }, { productId: `f${i}`, warehouseId: MAIN_WH, quantity: 50 });
    expected[`MOAK-F${i}`] = i % 4;
  }
  await prisma.product.createMany({ data: products });
  await prisma.inventory.createMany({ data: inventory });
  await frame('negative', 'MOAK-NEGATIVE', { site: -2, main: 9 });
  expected['MOAK-NEGATIVE'] = 0;
  await frame('main-only', 'MOAK-MAIN-ONLY', { main: 9 });
  expected['MOAK-MAIN-ONLY'] = 0;
  await frame('no-web-id', null, { site: 5, main: 5 });
  await setStock('f1', 7); // the count at sending time, not the one logged first
  expected['MOAK-F1'] = 7;
  // The site never accepted a count for these, so this many at 0 would wait for an admin.
  assert.equal(await approveStockZeros(Object.keys(expected).filter((webId) => expected[webId] === 0)), true);

  const result = await drainSiteHook();
  assert.equal(result.ok, true, result.message);
  assert.equal(result.held, 0);
  assert.equal(result.sent, 103);
  assert.deepEqual(site.seen.map((req) => req.body.items.length), [100, 3]);

  for (const req of site.seen) {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/erp/hook');
    assert.equal(req.headers['content-type'], 'application/json');
    assert.equal(req.headers['content-length'], String(req.raw.length));
    assert.equal(req.headers.authorization, undefined, 'the signature alone: the site checks only one of the two');
    assert.equal(req.headers['x-erp-signature'], signature(req.raw), 'HMAC-SHA256 of the raw bytes');
    assert.notEqual(req.headers['x-erp-signature'], signature(JSON.stringify(req.body, null, 2)), 're-serialized bytes must not verify');
    assert.equal(req.body.event, 'stock.changed');
    assert.equal(req.body.warehouseId, SITE_WH);
    for (const item of req.body.items) {
      assert.deepEqual(Object.keys(item).sort(), ['quantity', 'webId'], `stock only, no price: ${JSON.stringify(item)}`);
      assert.ok(Number.isInteger(item.quantity) && item.quantity >= 0, JSON.stringify(item));
    }
  }
  const webIds = site.seen.flatMap((req) => req.body.items.map((item: any) => item.webId));
  assert.equal(new Set(webIds).size, webIds.length, 'each webId once');
  assert.deepEqual(sent(site), expected);

  assert.equal(await prisma.siteHookLog.count(), 0);
  assert.deepEqual(await states(), expected);
  assert.equal(await readSiteHookHold(), null, 'every approved zero went out');
  const status = await readSiteHookStatus();
  assert.ok(status.lastOkAt);
  assert.equal(status.paused, null);
});

test('a count changed only in another warehouse sends nothing, and its rows are removed', async () => {
  const site = await fakeSite();
  await connect(site.url);
  await frame('p', 'MOAK-PANJ-BLUE', { site: 4, main: 10 });
  await prisma.siteHookLog.deleteMany();
  await setStock('p', 3, MAIN_WH);
  await frame('q', null, {});
  await prisma.inventory.create({ data: { productId: 'q', warehouseId: MAIN_WH, quantity: 1 } });
  assert.equal(await prisma.siteHookLog.count(), 2);

  const result = await drainSiteHook();
  assert.equal(result.ok, true, result.message);
  assert.equal(result.sent, 0);
  assert.equal(site.seen.length, 0);
  assert.equal(await prisma.siteHookLog.count(), 0);
});

// ── When the site does not accept ───────────────────────────────────────────

const refusals: Array<{ name: string; answer: Answer; why: RegExp; skip?: string }> = [
  { name: '200 with ignored', answer: { json: { ok: true, applied: 0, ignored: "not the website's warehouse" } }, why: /انبار/ },
  // A 200 that is not the contract (a shop page at a wrong address) must not count as delivered.
  { name: '200 with an HTML page', answer: { html: '<!doctype html><title>TheMoak</title><h1>Shop</h1>' }, why: /قرارداد/ },
  { name: '404 with an HTML page', answer: { status: 404, html: '<!doctype html><title>404</title><h1>Not Found</h1>' }, why: /404/ },
  { name: '422', answer: { status: 422, json: { ok: false, why: 'unreadable body', issues: {} } }, why: /422/ },
  { name: '401', answer: { status: 401, json: { ok: false, why: 'bad signature' } }, why: /رمز/ },
  { name: '503', answer: { status: 503, json: { ok: false, why: 'erp is switched off' } }, why: /erp is switched off/ },
  // fetch reports a refused redirect only in error.cause.message. The Location is a
  // closed port, so following it would fail too.
  {
    name: 'a redirect',
    answer: { status: 301, headers: { location: 'http://127.0.0.1:9/erp/hook' }, html: '<h1>Moved</h1>' },
    why: /ریدایرکت/,
  },
];

for (const refusal of refusals) {
  test(`a site answer of ${refusal.name} keeps the log and pauses; clearing the pause sends again`, { skip: refusal.skip }, async () => {
    const site = await fakeSite(() => refusal.answer);
    await connect(site.url);
    await frame('p', 'MOAK-PANJ-BLUE', { site: 4 });
    await prisma.siteHookLog.deleteMany();
    await setStock('p', 3);

    const first = await drainSiteHook();
    assert.equal(first.ok, false);
    assert.match(first.message, refusal.why);
    assert.equal(site.seen.length, 1, 'a configuration failure is not retried');
    assert.equal(await prisma.siteHookLog.count(), 1, 'the change is still owed');
    assert.equal(await prisma.siteHookState.count(), 0);
    const status = await readSiteHookStatus();
    assert.ok(status.paused, 'automatic sends are paused');
    assert.match(status.paused.why, refusal.why);
    assert.equal(status.lastMessage, status.paused.why);
    assert.ok(status.failingSince);

    const second = await drainSiteHook();
    assert.equal(second.ok, false);
    assert.equal(second.message, status.paused.why);
    assert.equal(site.seen.length, 1, 'no request while paused, within 10 minutes');
    assert.equal(await prisma.siteHookLog.count(), 1);

    site.answer = accept;
    await clearSiteHookPause();
    const third = await drainSiteHook();
    assert.equal(third.ok, true, third.message);
    assert.equal(site.seen.length, 2);
    assert.deepEqual(sent(site, 1), { 'MOAK-PANJ-BLUE': 3 });
    assert.equal(await prisma.siteHookLog.count(), 0);
    const cleared = await readSiteHookStatus();
    assert.equal(cleared.paused, null);
    assert.equal(cleared.failingSince, null);
  });
}

test("an ignored delivery pauses with the site's own reason in the message", async () => {
  const reason = 'stock pull is switched off in the site panel';
  const site = await fakeSite(() => ({ json: { ok: true, applied: 0, ignored: reason } }));
  await connect(site.url);
  await frame('p', 'MOAK-PANJ-BLUE', { site: 4 });

  const result = await drainSiteHook();
  assert.equal(result.ok, false);
  assert.ok(result.message.includes(reason), result.message);
  assert.equal(site.seen.length, 1, 'a configuration failure is not retried');
  const status = await readSiteHookStatus();
  assert.ok(status.paused, 'automatic sends are paused');
  assert.ok(status.paused.why.includes(reason), status.paused.why);
  assert.ok(await prisma.siteHookLog.count(), 'the change is still owed');
  assert.equal(await prisma.siteHookState.count(), 0);
});

test('a paused push lets one probe through once 10 minutes have passed', async () => {
  const site = await fakeSite(() => ({ status: 401, json: { ok: false, why: 'bad signature' } }));
  await connect(site.url);
  await frame('p', 'MOAK-PANJ-BLUE', { site: 4 });
  await drainSiteHook();
  const status = await readSiteHookStatus();
  assert.ok(status.paused);

  const elevenMinutesAgo = new Date(Date.now() - 11 * 60_000).toISOString();
  await prisma.systemSetting.update({
    where: { key: SITE_HOOK_STATUS_KEY },
    data: { value: JSON.stringify({ ...status, paused: { ...status.paused, probedAt: elevenMinutesAgo } }) },
  });
  site.answer = accept;
  const probe = await drainSiteHook();
  assert.equal(probe.ok, true, probe.message);
  assert.equal(site.seen.length, 2);
  assert.equal((await readSiteHookStatus()).paused, null);
  assert.equal(await prisma.siteHookLog.count(), 0);
});

test('500 twice and then a valid answer delivers in one drain', async () => {
  const site = await fakeSite((req, n) => (n <= 2 ? { status: 500, json: { ok: false } } : accept(req)));
  await connect(site.url);
  await frame('p', 'MOAK-PANJ-BLUE', { site: 4 });

  const result = await drainSiteHook();
  assert.equal(result.ok, true, result.message);
  assert.equal(site.seen.length, 3);
  for (const req of site.seen) assert.deepEqual(req.body.items, [{ webId: 'MOAK-PANJ-BLUE', quantity: 4 }]);
  assert.equal(await prisma.siteHookLog.count(), 0);
  assert.deepEqual(await states(), { 'MOAK-PANJ-BLUE': 4 });
  assert.equal((await readSiteHookStatus()).paused, null);
});

test("a proxy's 503 page is retried like a temporary failure; the site's own 503 still pauses", async () => {
  const proxy: Answer = { status: 503, html: '<html><body><h1>503 Service Temporarily Unavailable</h1></body></html>' };
  const site = await fakeSite((req, n) => (n <= 2 ? proxy : accept(req)));
  await connect(site.url);
  await frame('p', 'MOAK-PANJ-BLUE', { site: 4 });

  const result = await drainSiteHook();
  assert.equal(result.ok, true, result.message);
  assert.equal(site.seen.length, 3);
  for (const req of site.seen) assert.deepEqual(req.body.items, [{ webId: 'MOAK-PANJ-BLUE', quantity: 4 }]);
  assert.equal(await prisma.siteHookLog.count(), 0);
  assert.deepEqual(await states(), { 'MOAK-PANJ-BLUE': 4 });
  assert.equal((await readSiteHookStatus()).paused, null);

  site.answer = () => ({ status: 503, json: { ok: false, why: 'erp is switched off' } });
  await setStock('p', 3);
  const off = await drainSiteHook();
  assert.equal(off.ok, false);
  assert.match(off.message, /erp is switched off/);
  assert.equal(site.seen.length, 4, 'a configuration failure is not retried');
  assert.ok((await readSiteHookStatus()).paused);
  assert.equal(await prisma.siteHookLog.count(), 1);
});

test('a site that keeps answering 500 gets three retries, keeps the rows and is not paused', async () => {
  const site = await fakeSite(() => ({ status: 500, json: { ok: false } }));
  await connect(site.url);
  await frame('p', 'MOAK-PANJ-BLUE', { site: 4 });
  const rows = await prisma.siteHookLog.count();

  const started = Date.now();
  const result = await drainSiteHook();
  assert.ok(Date.now() - started >= 3_000, 'backoff of 0.5, 1 and 2 seconds');
  assert.equal(result.ok, false);
  assert.match(result.message, /500/);
  assert.equal(site.seen.length, 4);
  assert.equal(await prisma.siteHookLog.count(), rows);
  const status = await readSiteHookStatus();
  assert.equal(status.paused, null, 'a transient failure is not a configuration failure');
  assert.ok(status.failingSince);
  // The lease is kept in UTC, whatever the session's time zone.
  const [lease] = (await prisma.$queryRawUnsafe(
    `SELECT "until" < now() AT TIME ZONE 'UTC' AS free FROM "SiteHookLease" WHERE "id" = 1`,
  )) as Array<{ free: boolean }>;
  assert.equal(lease.free, true, 'the lease is released for the next run');
});

test('an unknown outcome (504) keeps the rows and the lease, so nothing newer overtakes it', async () => {
  const site = await fakeSite(() => ({ status: 504, html: '<html><body>Gateway Timeout</body></html>' }));
  await connect(site.url);
  await frame('p', 'MOAK-PANJ-BLUE', { site: 4 });
  const rows = await prisma.siteHookLog.count();

  const first = await drainSiteHook();
  assert.equal(first.ok, false);
  assert.match(first.message, /504/);
  assert.equal(site.seen.length, 1, 'an unknown outcome is not retried');
  assert.equal(await prisma.siteHookLog.count(), rows);
  assert.equal((await readSiteHookStatus()).paused, null);
  const [lease] = (await prisma.$queryRawUnsafe(
    `SELECT "holder" IS NOT NULL AND "until" > now() AT TIME ZONE 'UTC' AS held FROM "SiteHookLease" WHERE "id" = 1`,
  )) as Array<{ held: boolean }>;
  assert.equal(lease.held, true, 'the lease is kept until it runs out');

  site.answer = accept;
  await setStock('p', 3);
  const second = await drainSiteHook();
  assert.match(second.message, BUSY);
  assert.equal(site.seen.length, 1, 'no request while the lease runs');

  await prisma.siteHookLease.deleteMany(); // as if the 90 s had passed
  const third = await drainSiteHook();
  assert.equal(third.ok, true, third.message);
  assert.equal(site.seen.length, 2);
  assert.deepEqual(sent(site, 1), { 'MOAK-PANJ-BLUE': 3 });
  assert.equal(await prisma.siteHookLog.count(), 0);
});

test('switched off, a drain calls nothing and empties the log; a full resync after switching on sends everything', async () => {
  const site = await fakeSite();
  await connect(site.url, { stockPushEnabled: false });
  await frame('p', 'MOAK-PANJ-BLUE', { site: 4 });
  await frame('q', 'MOAK-YEK-BLACK', { site: 0, main: 3 });
  await frame('r', null, { site: 2 });
  assert.ok((await prisma.siteHookLog.count()) > 0);

  const off = await drainSiteHook();
  assert.equal(off.ok, true, off.message);
  assert.equal(site.seen.length, 0);
  assert.equal(await prisma.siteHookLog.count(), 0);

  await connect(site.url, { stockPushEnabled: true });
  assert.equal(await enqueueFullResync(), 2);
  const on = await drainSiteHook();
  assert.equal(on.ok, true, on.message);
  assert.deepEqual(sent(site), { 'MOAK-PANJ-BLUE': 4, 'MOAK-YEK-BLACK': 0 });
  assert.equal(await prisma.siteHookLog.count(), 0);
});

// ── Mass zero ───────────────────────────────────────────────────────────────

/** `count` frames the site last accepted as in stock (1), and whose site stock is now 0. */
async function framesGoingOut(count: number, prefix = 'ZERO') {
  const ids = Array.from({ length: count }, (_, i) => `z${i}`);
  const webIds = ids.map((_, i) => `MOAK-${prefix}-${i}`);
  await prisma.product.createMany({ data: ids.map((id, i) => ({ id, name: id, sku: id.toUpperCase(), costPrice: 1, sellPrice: 1, webId: webIds[i] })) });
  await prisma.inventory.createMany({ data: ids.map((productId) => ({ productId, warehouseId: SITE_WH, quantity: 1 })) });
  await prisma.siteHookState.createMany({ data: webIds.map((webId) => ({ webId, quantity: 1 })) });
  await prisma.siteHookLog.deleteMany();
  await prisma.inventory.updateMany({ where: { productId: { in: ids } }, data: { quantity: 0 } });
  return webIds;
}

test(`${MASS_ZERO_THRESHOLD} frames going from in stock to 0 together wait for an admin; one alone goes at once`, async () => {
  const site = await fakeSite();
  await connect(site.url);
  await frame('other', 'MOAK-OTHER', { site: 3 });
  await frame('solo', 'MOAK-SOLO', { site: 1 });
  await prisma.siteHookState.createMany({ data: [{ webId: 'MOAK-OTHER', quantity: 3 }, { webId: 'MOAK-SOLO', quantity: 1 }] });
  const zeros = await framesGoingOut(MASS_ZERO_THRESHOLD);
  await setStock('other', 2);

  const first = await drainSiteHook();
  assert.equal(first.ok, true, first.message);
  assert.equal(first.held, MASS_ZERO_THRESHOLD);
  assert.deepEqual(sent(site), { 'MOAK-OTHER': 2 }, 'none of the ten; the rest of the delivery still goes');
  const hold = await readSiteHookHold();
  assert.equal(hold?.state, 'held');
  assert.deepEqual([...(hold?.webIds ?? [])].sort(), [...zeros].sort());
  assert.equal(await prisma.siteHookLog.count(), MASS_ZERO_THRESHOLD, 'the held changes are still owed');
  assert.equal((await states())[zeros[0]], 1);

  // A sale of one frame never waits, even while a hold is open.
  await setStock('solo', 0);
  const second = await drainSiteHook();
  assert.equal(second.ok, true, second.message);
  assert.equal(site.seen.length, 2);
  assert.deepEqual(sent(site, 1), { 'MOAK-SOLO': 0 });
  assert.equal((await readSiteHookHold())?.state, 'held');

  assert.equal(await releaseSiteHookHold(zeros), true);
  const third = await drainSiteHook();
  assert.equal(third.ok, true, third.message);
  assert.equal(third.held, 0);
  assert.equal(site.seen.length, 3);
  assert.deepEqual(sent(site, 2), Object.fromEntries(zeros.map((webId) => [webId, 0])));
  assert.equal(await readSiteHookHold(), null, 'the hold is cleared once they went out');
  assert.equal(await prisma.siteHookLog.count(), 0);
  assert.equal((await states())[zeros[0]], 0);
});

test(`${MASS_ZERO_THRESHOLD - 1} frames going from in stock to 0 together go out at once`, async () => {
  assert.equal(MASS_ZERO_THRESHOLD, 10, 'the owner decision: 10 or more frames wait for an admin');
  const site = await fakeSite();
  await connect(site.url);
  const zeros = await framesGoingOut(MASS_ZERO_THRESHOLD - 1);

  const result = await drainSiteHook();
  assert.equal(result.ok, true, result.message);
  assert.equal(result.held, 0);
  assert.deepEqual(sent(site), Object.fromEntries(zeros.map((webId) => [webId, 0])));
  assert.equal(await readSiteHookHold(), null);
  assert.equal(await prisma.siteHookLog.count(), 0);
});

test('frames an admin approved in the preview go to 0 without a hold', async () => {
  const site = await fakeSite();
  await connect(site.url);
  const zeros = await framesGoingOut(MASS_ZERO_THRESHOLD);

  await approveStockZeros(zeros);
  const result = await drainSiteHook();
  assert.equal(result.ok, true, result.message);
  assert.equal(result.held, 0);
  assert.equal(site.seen.length, 1);
  assert.deepEqual(sent(site), Object.fromEntries(zeros.map((webId) => [webId, 0])));
  assert.equal(await readSiteHookHold(), null);
  assert.equal(await prisma.siteHookLog.count(), 0);
});

// A release spans several batches: each batch must remove only what it sent from
// the stored hold, or the first batch's frames stay approved for good.
test('releasing a hold of more than 100 frames clears the hold, so the same mass zero waits for an admin again', async () => {
  const site = await fakeSite();
  await connect(site.url);
  const zeros = await framesGoingOut(101);
  const ids = zeros.map((_, i) => `z${i}`);

  const held = await drainSiteHook();
  assert.equal(held.held, 101);
  assert.equal(site.seen.length, 0);

  // The mistake is undone before an admin looks; the release sends the counts as they are now.
  await prisma.inventory.updateMany({ where: { productId: { in: ids } }, data: { quantity: 1 } });
  assert.equal(await releaseSiteHookHold(zeros), true);
  const released = await drainSiteHook();
  assert.equal(released.ok, true, released.message);
  assert.deepEqual(site.seen.map((req) => req.body.items.length), [100, 1]);
  assert.deepEqual(sent(site), Object.fromEntries(zeros.map((webId) => [webId, 1])));
  assert.equal(await prisma.siteHookLog.count(), 0);
  assert.equal(await readSiteHookHold(), null, 'every released frame went out, so nothing stays approved');

  // The same mistake again.
  await prisma.inventory.updateMany({ where: { productId: { in: ids } }, data: { quantity: 0 } });
  const again = await drainSiteHook();
  assert.equal(again.held, 101);
  assert.equal(site.seen.length, 2, 'no frame goes to 0 on the site without an admin');
});

test('a held frame whose count is fixed above 0 goes out with that count, without a release, and leaves the hold', async () => {
  const site = await fakeSite();
  await connect(site.url);
  const zeros = await framesGoingOut(MASS_ZERO_THRESHOLD);
  const held = await drainSiteHook();
  assert.equal(held.held, MASS_ZERO_THRESHOLD);
  assert.equal(site.seen.length, 0);

  await setStock('z0', 2);
  const one = await drainSiteHook();
  assert.equal(one.ok, true, one.message);
  assert.equal(one.held, MASS_ZERO_THRESHOLD - 1);
  assert.deepEqual(sent(site), { [zeros[0]]: 2 });
  assert.equal((await states())[zeros[0]], 2);
  const hold = await readSiteHookHold();
  assert.equal(hold?.state, 'held', 'the others still wait for an admin');
  assert.deepEqual([...(hold?.webIds ?? [])].sort(), zeros.slice(1).sort());

  const rest = zeros.slice(1).map((_, i) => `z${i + 1}`);
  await prisma.inventory.updateMany({ where: { productId: { in: rest } }, data: { quantity: 3 } });
  const fixed = await drainSiteHook();
  assert.equal(fixed.ok, true, fixed.message);
  assert.equal(fixed.held, 0);
  assert.deepEqual(sent(site, 1), Object.fromEntries(zeros.slice(1).map((webId) => [webId, 3])));
  assert.equal(await prisma.systemSetting.findUnique({ where: { key: SITE_HOOK_HOLD_KEY } }), null, 'nothing is left, so the hold is gone');
  assert.equal(await prisma.siteHookLog.count(), 0);
});

for (const refusedBefore of [false, true]) {
  test(`${MASS_ZERO_THRESHOLD} frames at 0 whose count the site never accepted (${refusedBefore ? 'only refused' : 'no state row'}) are held until an admin approves them`, async () => {
    const site = await fakeSite();
    await connect(site.url);
    // A webId, no stock row in the site warehouse, nothing the site ever accepted: the site may show them in stock.
    const webIds = Array.from({ length: MASS_ZERO_THRESHOLD }, (_, i) => `MOAK-NEW-${i}`);
    await prisma.product.createMany({
      data: webIds.map((webId, i) => ({ id: `n${i}`, name: `n${i}`, sku: `N${i}`, costPrice: 1, sellPrice: 1, webId })),
    });
    // A state row with a reason but no quantity: the site skipped every count it was sent.
    if (refusedBefore) await prisma.siteHookState.createMany({ data: webIds.map((webId) => ({ webId, quantity: null, skipWhy: 'unknown webId', skipAt: new Date() })) });

    const held = await drainSiteHook();
    assert.equal(held.ok, true, held.message);
    assert.equal(held.held, MASS_ZERO_THRESHOLD);
    assert.equal(held.sent, 0);
    assert.equal(site.seen.length, 0);
    const hold = await readSiteHookHold();
    assert.equal(hold?.state, 'held');
    assert.deepEqual([...(hold?.webIds ?? [])].sort(), [...webIds].sort());
    assert.equal(await prisma.siteHookLog.count(), MASS_ZERO_THRESHOLD);

    assert.equal(await approveStockZeros(webIds), true);
    const approved = await drainSiteHook();
    assert.equal(approved.ok, true, approved.message);
    assert.equal(approved.held, 0);
    assert.deepEqual(sent(site), Object.fromEntries(webIds.map((webId) => [webId, 0])));
    assert.deepEqual(await states(), Object.fromEntries(webIds.map((webId) => [webId, 0])));
    assert.equal(await readSiteHookHold(), null);
    assert.equal(await prisma.siteHookLog.count(), 0);
  });
}

test('a frame that goes to 0 after the hold check is left out of the request, and its log rows stay', async () => {
  const site = await fakeSite();
  await connect(site.url);
  await frame('late', 'MOAK-LATE', { site: 2 });
  await frame('other', 'MOAK-OTHER', { site: 3 });
  await prisma.siteHookState.createMany({ data: [{ webId: 'MOAK-LATE', quantity: 2 }, { webId: 'MOAK-OTHER', quantity: 3 }] });
  await prisma.siteHookLog.deleteMany();
  await setStock('late', 1);
  await setStock('other', 2);
  const lateRows = (await prisma.siteHookLog.findMany({ where: { productId: 'late' }, select: { id: true } })).map((row: any) => row.id);
  assert.equal(lateRows.length, 1);

  let reads = 0;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Inventory' || params.action !== 'findMany' || ++reads < 2) return;
    // The second read of the pass is deliver's, after the hold check: a sale takes the last one right now,
    // and a purchase raises the other one.
    beforeQuery.fn = null;
    await setStock('late', 0);
    await setStock('other', 5);
  };
  try {
    const result = await drainSiteHook();
    assert.equal(result.ok, true, result.message);
  } finally {
    beforeQuery.fn = null;
  }
  assert.equal(reads, 2, 'the hook fired on deliver’s read');
  assert.ok(site.seen.length >= 1);
  assert.deepEqual(
    site.seen[0].body.items,
    [{ webId: 'MOAK-OTHER', quantity: 5 }],
    'the frame that went to 0 is not in the request, and the other carries the count read at send time',
  );
  for (const req of site.seen) {
    for (const item of req.body.items) {
      if (item.webId === 'MOAK-LATE') assert.equal(item.quantity, 0, 'never sent with the count read before it went to 0');
    }
  }
  assert.equal(await prisma.siteHookLog.count({ where: { id: { in: lateRows } } }), lateRows.length, 'its log rows stay');
});

test('approving zeros or releasing a hold is refused unless it covers exactly the held list', async () => {
  const site = await fakeSite();
  await connect(site.url);
  const zeros = await framesGoingOut(MASS_ZERO_THRESHOLD);
  await drainSiteHook();
  const stored = async () => (await prisma.systemSetting.findUnique({ where: { key: SITE_HOOK_HOLD_KEY } }))?.value;
  const before = await stored();
  assert.equal((await readSiteHookHold())?.state, 'held');

  assert.equal(await approveStockZeros(zeros.slice(1)), false, 'a held frame outside the approved list');
  assert.equal(await approveStockZeros(['MOAK-SOMETHING-ELSE']), false);
  assert.equal(await approveStockZeros([]), false);
  assert.equal(await releaseSiteHookHold(zeros.slice(1)), false, 'fewer frames than are held');
  assert.equal(await releaseSiteHookHold([...zeros, 'MOAK-NEW-ZERO']), false, 'more frames than are held');
  assert.equal(await releaseSiteHookHold([]), false);
  assert.equal(await stored(), before, 'the hold is unchanged');

  const still = await drainSiteHook();
  assert.equal(still.held, MASS_ZERO_THRESHOLD);
  assert.equal(site.seen.length, 0, 'nothing went out');
  assert.equal(await stored(), before);

  assert.equal(await releaseSiteHookHold([...zeros].reverse()), true, 'the same list in another order');
  assert.equal((await readSiteHookHold())?.state, 'released');
  assert.equal(await releaseSiteHookHold(zeros), false, 'nothing is held any more');
});

test(
  'a drain that delivers a held frame while an admin releases the hold never writes that frame back into it',
  async () => {
    const site = await fakeSite();
    await connect(site.url);
    const zeros = await framesGoingOut(MASS_ZERO_THRESHOLD);
    assert.equal((await drainSiteHook()).held, MASS_ZERO_THRESHOLD);
    await setStock('z0', 2);

    let settingQueries = 0;
    beforeQuery.fn = async (params) => {
      if (params.model !== 'SystemSetting' || ++settingQueries < 2) return;
      // The release has read the hold and not yet written it: a scheduled drain delivers z0 and prunes it.
      beforeQuery.fn = null;
      await drainSiteHook();
    };
    try {
      await releaseSiteHookHold(zeros);
    } finally {
      beforeQuery.fn = null;
    }
    assert.deepEqual(sent(site), { [zeros[0]]: 2 }, 'the drain ran between the read and the write');
    // Left in a released hold, z0 would later go to 0 with nine others without an admin.
    assert.ok(!(await readSiteHookHold())?.webIds.includes(zeros[0]), JSON.stringify(await readSiteHookHold()));
  },
);

test(`an audit adjustment that takes ${MASS_ZERO_THRESHOLD} frames to 0 is held by the next drain, and none is sent`, async () => {
  const site = await fakeSite();
  await connect(site.url);
  const ids = Array.from({ length: MASS_ZERO_THRESHOLD }, (_, i) => `a${i}`);
  const webIds = ids.map((_, i) => `MOAK-AUDIT-${i}`);
  await prisma.product.createMany({ data: ids.map((id, i) => ({ id, name: id, sku: id.toUpperCase(), costPrice: 1, sellPrice: 1, webId: webIds[i] })) });
  await prisma.inventory.createMany({ data: ids.map((productId) => ({ productId, warehouseId: SITE_WH, quantity: 2 })) });
  await prisma.siteHookState.createMany({ data: webIds.map((webId) => ({ webId, quantity: 2 })) });
  await prisma.siteHookLog.deleteMany();
  const audit = await prisma.inventoryAudit.create({
    data: { warehouseId: SITE_WH, auditNumber: 'AUD-2026-0001', status: 'IN_PROGRESS', isFrozen: true },
  });
  await prisma.inventoryAuditItem.createMany({
    data: ids.map((productId) => ({ auditId: audit.id, productId, systemQuantity: 2, finalQuantity: 0, discrepancy: -2 })),
  });

  let upserts = 0;
  const midway: DrainResult[] = [];
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Inventory' || params.action !== 'upsert' || ++upserts <= MASS_ZERO_THRESHOLD / 2) return;
    beforeQuery.fn = null;
    // A scheduled drain halfway through: one transaction shows it none of the adjustments yet.
    midway.push(await drainSiteHook());
  };
  try {
    const issued = await issueAdjustmentDocuments(audit.id);
    assert.equal(issued.success, true, issued.message);
  } finally {
    beforeQuery.fn = null;
  }
  assert.equal(midway.length, 1, 'the drain ran inside the adjustment');
  assert.equal(midway[0].sent, 0);
  assert.equal(site.seen.length, 0, 'no part of the adjustment went out on its own');
  const counts = await prisma.inventory.findMany({ where: { warehouseId: SITE_WH }, select: { quantity: true } });
  assert.deepEqual(counts.map((row: any) => row.quantity), ids.map(() => 0));

  const result = await drainSiteHook();
  assert.equal(result.ok, true, result.message);
  assert.equal(result.held, MASS_ZERO_THRESHOLD);
  assert.equal(result.sent, 0);
  assert.equal(site.seen.length, 0);
  const hold = await readSiteHookHold();
  assert.equal(hold?.state, 'held');
  assert.deepEqual([...(hold?.webIds ?? [])].sort(), [...webIds].sort());
  assert.equal(await prisma.siteHookLog.count(), MASS_ZERO_THRESHOLD, 'the changes are still owed');
  assert.deepEqual(await states(), Object.fromEntries(webIds.map((webId) => [webId, 2])));
});

test(
  `${MASS_ZERO_THRESHOLD} frames taken to 0 by one write are held even when their log rows fall into two passes`,
  async () => {
    const site = await fakeSite();
    await connect(site.url);
    const ids = Array.from({ length: MASS_ZERO_THRESHOLD }, (_, i) => `z${i}`);
    const webIds = ids.map((_, i) => `MOAK-ZERO-${i}`);
    await prisma.product.createMany({ data: ids.map((id, i) => ({ id, name: id, sku: id.toUpperCase(), costPrice: 1, sellPrice: 1, webId: webIds[i] })) });
    await prisma.inventory.createMany({ data: ids.map((productId) => ({ productId, warehouseId: SITE_WH, quantity: 1 })) });
    await prisma.siteHookState.createMany({ data: webIds.map((webId) => ({ webId, quantity: 1 })) });
    await frame('main', null, { main: 1 });
    await prisma.siteHookLog.deleteMany();
    // 995 older changes still owed in another warehouse: the one write's ten rows land on both sides of row 1,000.
    await prisma.siteHookLog.createMany({ data: Array.from({ length: 995 }, () => ({ productId: 'main', kind: 'stock', warehouseId: MAIN_WH })) });
    await prisma.inventory.updateMany({ where: { productId: { in: ids } }, data: { quantity: 0 } });

    const result = await drainSiteHook();
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(sent(site), {}, 'none of the ten went to 0 on the site without an admin');
    const hold = await readSiteHookHold();
    assert.equal(hold?.state, 'held');
    assert.deepEqual([...(hold?.webIds ?? [])].sort(), [...webIds].sort());
    assert.equal(await prisma.siteHookLog.count(), MASS_ZERO_THRESHOLD, 'the held changes are still owed');
  },
);

/** `count` frames in stock at 1, as the site last accepted them. The log is left empty. */
async function framesInStock(prefix: string, count = MASS_ZERO_THRESHOLD) {
  const ids = Array.from({ length: count }, (_, i) => `${prefix.toLowerCase()}${i}`);
  const webIds = ids.map((_, i) => `MOAK-${prefix}-${i}`);
  await prisma.product.createMany({ data: ids.map((id, i) => ({ id, name: id, sku: id.toUpperCase(), costPrice: 1, sellPrice: 1, webId: webIds[i] })) });
  await prisma.inventory.createMany({ data: ids.map((productId) => ({ productId, warehouseId: SITE_WH, quantity: 1 })) });
  await prisma.siteHookState.createMany({ data: webIds.map((webId) => ({ webId, quantity: 1 })) });
  await prisma.siteHookLog.deleteMany();
  return { ids, webIds };
}

const toZero = (ids: string[]) => prisma.inventory.updateMany({ where: { productId: { in: ids } }, data: { quantity: 0 } });

/** The frames among `webIds` the site was ever told are at 0. */
const zerosSentOf = (site: FakeSite, webIds: string[]) =>
  webIds.filter((webId) => site.seen.some((req) => (req.body?.items ?? []).some((item: any) => item.webId === webId && item.quantity === 0)));

/** Runs `action` right before the next write of the hold (an updateMany or createMany on its key). */
function beforeHoldWrite(action: () => Promise<unknown>) {
  const state: { fired: boolean; value?: unknown } = { fired: false };
  beforeQuery.fn = async (params: any) => {
    if (params.model !== 'SystemSetting') return;
    const key =
      params.action === 'updateMany' ? params.args?.where?.key : params.action === 'createMany' ? params.args?.data?.[0]?.key : null;
    if (key !== SITE_HOOK_HOLD_KEY) return;
    beforeQuery.fn = null;
    state.fired = true;
    state.value = await action();
  };
  return state;
}

function latch() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

for (const owed of [995, 0]) {
  test(`one write that takes ${MASS_ZERO_THRESHOLD} frames to 0 and commits after a pass has read past half its rows is held as one (${owed ? 'first pass full' : 'first pass not full'})`, async () => {
    const site = await fakeSite();
    await connect(site.url);
    const { ids, webIds } = await framesInStock('ZERO');
    await frame('other', 'MOAK-OTHER', { site: 3 });
    await prisma.siteHookLog.deleteMany();
    if (owed) await prisma.siteHookLog.createMany({ data: Array.from({ length: owed }, () => ({ productId: 'other', kind: 'resync' })) });

    // One transaction takes five frames to 0, a sale elsewhere commits meanwhile, then five more:
    // its log ids fall on both sides of the sale's.
    const firstHalf = latch();
    const saleDone = latch();
    const secondHalf = latch();
    const commit = latch();
    const write = prisma.$transaction(
      async (tx: any) => {
        await tx.inventory.updateMany({ where: { productId: { in: ids.slice(0, 5) } }, data: { quantity: 0 } });
        firstHalf.open();
        await saleDone.opened;
        await tx.inventory.updateMany({ where: { productId: { in: ids.slice(5) } }, data: { quantity: 0 } });
        secondHalf.open();
        await commit.opened;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    await firstHalf.opened;
    for (let i = 0; i < 5; i++) await setStock('other', i % 2 === 0 ? 2 : 3);
    saleDone.open();
    await secondHalf.opened;

    let reads = 0;
    beforeQuery.fn = async (params: any) => {
      if (params.model !== 'SiteHookLog' || params.action !== 'findMany' || ++reads < 2) return;
      beforeQuery.fn = null;
      // It commits after the first pass read past its lower rows, before the second pass reads.
      commit.open();
      await write;
    };
    try {
      await drainSiteHook();
    } finally {
      beforeQuery.fn = null;
      commit.open();
      await write.catch(() => undefined);
    }
    assert.ok(reads >= 2, 'a second pass ran');
    await drainSiteHook();

    assert.deepEqual(zerosSentOf(site, webIds), [], 'none of the ten went to 0 on the site without an admin');
    const hold = await readSiteHookHold();
    assert.equal(hold?.state, 'held');
    assert.deepEqual([...(hold?.webIds ?? [])].sort(), [...webIds].sort());
  });
}

test('a release that lands right before a drain records a new mass zero lets out only the released frames, and the zeros stay held after one is restocked', async () => {
  const site = await fakeSite();
  await connect(site.url);
  const held = await framesInStock('HELD');
  const zero = await framesInStock('ZERO');
  await toZero(held.ids);
  assert.equal((await drainSiteHook()).held, MASS_ZERO_THRESHOLD);
  await toZero(zero.ids);

  const race = beforeHoldWrite(() => releaseSiteHookHold(held.webIds));
  try {
    await drainSiteHook();
  } finally {
    beforeQuery.fn = null;
  }
  assert.equal(race.fired, true);
  assert.equal(race.value, true, 'the admin release went through');
  assert.deepEqual(zerosSentOf(site, held.webIds).sort(), [...held.webIds].sort(), 'the released frames went out at 0');
  assert.deepEqual(zerosSentOf(site, zero.webIds), []);

  // One unit of the first comes back before the next drain; the other nine went to 0 together and still wait.
  await setStock(zero.ids[0], 1);
  await drainSiteHook();
  assert.deepEqual(zerosSentOf(site, zero.webIds), []);
  assert.equal(sent(site)[zero.webIds[0]], 1);
  const hold = await readSiteHookHold();
  assert.equal(hold?.state, 'held');
  assert.deepEqual([...(hold?.webIds ?? [])].sort(), zero.webIds.slice(1).sort());
});

test('an approval that lands right before a drain records a mass zero whose rows span two passes does not let the zeros out', async () => {
  const site = await fakeSite();
  await connect(site.url);
  const zero = await framesInStock('ZERO');
  await frame('main', null, { main: 1 });
  await prisma.siteHookLog.deleteMany();
  await prisma.siteHookLog.createMany({ data: Array.from({ length: 995 }, () => ({ productId: 'main', kind: 'stock', warehouseId: MAIN_WH })) });
  await toZero(zero.ids);

  const race = beforeHoldWrite(() => approveStockZeros(['MOAK-SOMETHING-ELSE']));
  try {
    await drainSiteHook();
  } finally {
    beforeQuery.fn = null;
  }
  assert.equal(race.fired, true);
  assert.equal(race.value, true, 'the approval went through');
  await drainSiteHook();

  assert.deepEqual(zerosSentOf(site, zero.webIds), []);
  const hold = await readSiteHookHold();
  assert.equal(hold?.state, 'held');
  assert.deepEqual([...(hold?.webIds ?? [])].sort(), [...zero.webIds].sort());
});

test('an approval that loses its write to a delivery emptying the hold is written again, not refused', async () => {
  const site = await fakeSite();
  await connect(site.url);
  await frame('a', 'MOAK-A', { site: 0 });
  await frame('b', 'MOAK-B', { site: 0 });
  // As just after switching on: both approved, their rows not yet sent.
  await prisma.systemSetting.create({
    data: { key: SITE_HOOK_HOLD_KEY, value: JSON.stringify({ state: 'released', since: new Date().toISOString(), webIds: ['MOAK-A', 'MOAK-B'] }) },
  });

  const race = beforeHoldWrite(() => drainSiteHook());
  let approved = false;
  try {
    approved = await approveStockZeros(['MOAK-B']);
  } finally {
    beforeQuery.fn = null;
  }
  assert.equal(race.fired, true);
  assert.equal((race.value as DrainResult).sent, 2, 'the delivery ran between the approval’s read and its write');
  assert.equal(approved, true);
  const hold = await readSiteHookHold();
  assert.deepEqual(hold && { state: hold.state, webIds: hold.webIds }, { state: 'released', webIds: ['MOAK-B'] });
});

// ── Retired webIds ──────────────────────────────────────────────────────────

test('changing a webId from A to B tells the site A is gone and sends B with the current stock', async () => {
  const site = await fakeSite();
  await connect(site.url);
  await frame('p', 'MOAK-PANJ-BLUE', { site: 4, main: 8 });
  await prisma.siteHookState.create({ data: { webId: 'MOAK-PANJ-BLUE', quantity: 4 } });
  await prisma.siteHookLog.deleteMany();
  await prisma.product.update({ where: { id: 'p' }, data: { webId: 'MOAK-PANJ-NAVY' } });

  const result = await drainSiteHook();
  assert.equal(result.ok, true, result.message);
  assert.equal(site.seen.length, 1);
  assert.deepEqual(sent(site), { 'MOAK-PANJ-BLUE': 0, 'MOAK-PANJ-NAVY': 4 });
  assert.deepEqual(await states(), { 'MOAK-PANJ-BLUE': 0, 'MOAK-PANJ-NAVY': 4 });
  assert.equal(await prisma.siteHookLog.count(), 0);
});

for (const holderRowWaiting of [false, true]) {
  test(`a retired webId another product holds is never sent as 0 (the holder's own row ${holderRowWaiting ? 'still waiting' : 'already sent'})`, async () => {
    const site = await fakeSite();
    await connect(site.url);
    await frame('p', 'MOAK-PANJ-BLUE', { site: 4 });
    await frame('q', null, { site: 7 });
    await prisma.siteHookLog.deleteMany();
    await prisma.$transaction(async (tx: any) => {
      await tx.product.update({ where: { id: 'p' }, data: { webId: 'MOAK-PANJ-NAVY' } });
      await tx.product.update({ where: { id: 'q' }, data: { webId: 'MOAK-PANJ-BLUE' } });
    });
    // As if q's own 'webid' row had gone out in an earlier delivery.
    if (!holderRowWaiting) await prisma.siteHookLog.deleteMany({ where: { productId: 'q' } });

    const result = await drainSiteHook();
    assert.equal(result.ok, true, result.message);
    assert.equal(site.seen.length, 1);
    const items = site.seen[0].body.items;
    assert.equal(items.filter((item: any) => item.webId === 'MOAK-PANJ-BLUE').length, holderRowWaiting ? 1 : 0);
    assert.deepEqual(sent(site), holderRowWaiting ? { 'MOAK-PANJ-NAVY': 4, 'MOAK-PANJ-BLUE': 7 } : { 'MOAK-PANJ-NAVY': 4 });
    assert.equal(await prisma.siteHookLog.count(), 0);
  });
}

// ── Skipped items ───────────────────────────────────────────────────────────

test('an item the site skips keeps its last accepted quantity and its reason, until a later push is accepted', async () => {
  let skip = true;
  const site = await fakeSite((req) => {
    const items = req.body.items;
    const skipped = skip ? [{ key: 'MOAK-PANJ-BLUE', why: 'شمارش این محصول در پنل قفل است' }] : [];
    return { json: { ok: true, read: items.length, applied: items.length - skipped.length, skipped, changes: [] } };
  });
  await connect(site.url);
  await frame('p', 'MOAK-PANJ-BLUE', { site: 3 });
  await frame('q', 'MOAK-YEK-BLACK', { site: 2 });
  await prisma.siteHookState.createMany({ data: [{ webId: 'MOAK-PANJ-BLUE', quantity: 3 }, { webId: 'MOAK-YEK-BLACK', quantity: 2 }] });
  await prisma.siteHookLog.deleteMany();
  await setStock('p', 5);
  await setStock('q', 1);

  const first = await drainSiteHook();
  assert.equal(first.ok, true, first.message);
  assert.equal(first.skipped, 1);
  const refused = await prisma.siteHookState.findUniqueOrThrow({ where: { webId: 'MOAK-PANJ-BLUE' } });
  assert.equal(refused.skipWhy, 'شمارش این محصول در پنل قفل است');
  assert.ok(refused.skipAt);
  assert.equal(refused.quantity, 3, 'not the refused 5');
  const taken = await prisma.siteHookState.findUniqueOrThrow({ where: { webId: 'MOAK-YEK-BLACK' } });
  assert.equal(taken.quantity, 1);
  assert.equal(taken.skipWhy, null);
  assert.equal(await prisma.siteHookLog.count(), 0);
  assert.match(String((await readSiteHookStatus()).lastMessage), /نپذیرفت/);

  skip = false;
  await setStock('p', 6);
  const second = await drainSiteHook();
  assert.equal(second.ok, true, second.message);
  assert.equal(second.skipped, 0);
  const accepted = await prisma.siteHookState.findUniqueOrThrow({ where: { webId: 'MOAK-PANJ-BLUE' } });
  assert.equal(accepted.quantity, 6);
  assert.equal(accepted.skipWhy, null);
  assert.equal(accepted.skipAt, null);
  assert.equal((await readSiteHookStatus()).lastMessage, null);
});

// ── One drain at a time ─────────────────────────────────────────────────────

test('two drains started together: the site hears from only one, the other says a send is running', async () => {
  const site = await fakeSite((req) => ({ ...accept(req), delayMs: 400 }));
  await connect(site.url);
  await frame('p', 'MOAK-PANJ-BLUE', { site: 4 });
  await frame('q', 'MOAK-YEK-BLACK', { site: 2 });

  const results = await Promise.all([drainSiteHook(), drainSiteHook()]);
  const busy = results.filter((r) => BUSY.test(r.message));
  const ran = results.filter((r) => !BUSY.test(r.message));
  assert.equal(busy.length, 1, JSON.stringify(results));
  assert.equal(busy[0].sent, 0);
  assert.equal(ran[0].ok, true, ran[0].message);
  assert.equal(ran[0].sent, 2);
  assert.equal(site.seen.length, 1);
  assert.equal(await prisma.siteHookLog.count(), 0);
});

// ── The flush route ─────────────────────────────────────────────────────────

test('the flush route refuses without the right CRON_SECRET, and drains with it', async () => {
  const site = await fakeSite();
  await connect(site.url);
  await frame('p', 'MOAK-PANJ-BLUE', { site: 4 });
  const request = (authorization?: string, method = 'GET') =>
    new NextRequest('http://localhost/api/site/hook-flush', { method, headers: authorization ? { authorization } : {} });

  const previous = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await flushGET(request('Bearer undefined'))).status, 401, 'an unset CRON_SECRET refuses everything');

    process.env.CRON_SECRET = 'cron-test-secret';
    assert.equal((await flushGET(request())).status, 401);
    assert.equal((await flushGET(request('Bearer wrong'))).status, 401);
    assert.equal((await flushPOST(request('Bearer wrong', 'POST'))).status, 401);
    assert.equal(site.seen.length, 0);
    assert.ok((await prisma.siteHookLog.count()) > 0);

    const ok = await flushGET(request('Bearer cron-test-secret'));
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.ok, true, body.message);
    assert.equal(body.sent, 1);
    assert.equal(body.applied, 1);
    assert.equal(site.seen.length, 1);
    assert.equal(await prisma.siteHookLog.count(), 0);

    const again = await flushPOST(request('Bearer cron-test-secret', 'POST'));
    assert.equal(again.status, 200);
    assert.deepEqual(await again.json(), { ok: true, sent: 0, applied: 0, skipped: 0, held: 0, message: '' });
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

// ── Ping and preview ────────────────────────────────────────────────────────

/** The site's /erp/ping: checks the signature over the raw bytes and names its warehouse. */
function pingAnswer(warehouse: string) {
  return (req: Seen): Answer => {
    if (req.url !== '/erp/ping') return { status: 404, html: '<h1>Not Found</h1>' };
    if (req.headers['x-erp-signature'] !== signature(req.raw)) return { status: 401, json: { ok: false } };
    return { json: { ok: true, warehouse: warehouse || null, at: new Date().toISOString() } };
  };
}

test('pingSite returns the site warehouse for a signed ping, and a readable failure on 401 or 404', async () => {
  const site = await fakeSite(pingAnswer(SITE_WH));
  assert.deepEqual(await pingSite({ siteUrl: site.url, webhookSecret: SECRET }), { ok: true, warehouse: SITE_WH });
  assert.equal(site.seen[0].method, 'POST');
  assert.equal(site.seen[0].headers.authorization, undefined);

  const wrong = await pingSite({ siteUrl: site.url, webhookSecret: 'wrong-secret' });
  assert.equal(wrong.ok, false);
  assert.match(wrong.ok ? '' : wrong.message, /رمز/);

  const missing = await pingSite({ siteUrl: (await fakeSite(() => ({ status: 404, html: '<h1>Not Found</h1>' }))).url, webhookSecret: SECRET });
  assert.equal(missing.ok, false);
  assert.match(missing.ok ? '' : missing.message, /404/);

  const unset = await fakeSite(pingAnswer(''));
  assert.deepEqual(await pingSite({ siteUrl: unset.url, webhookSecret: SECRET }), { ok: true, warehouse: null });
});

test('previewStockPush compares the site warehouse stock with the catalogue inStock flags, and writes nothing', async () => {
  const catalogue = [
    { webId: 'MOAK-OUT', inStock: true },
    { webId: 'MOAK-OUT-MAIN', inStock: true },
    { webId: 'MOAK-IN', inStock: false },
    { webId: 'MOAK-SAME', inStock: true },
    { webId: 'MOAK-EMPTY', inStock: false },
    { webId: 'MOAK-NOT-IN-ERP', inStock: true },
  ];
  const site = await fakeSite((req) => {
    if (req.url !== '/erp/catalogue') return { status: 404, html: '<h1>Not Found</h1>' };
    if (req.headers.authorization !== `Bearer ${SECRET}`) return { status: 401, json: { ok: false } };
    return { json: { ok: true, count: catalogue.length, products: catalogue } };
  });
  await connect(site.url);
  await frame('out', 'MOAK-OUT', { site: 0, main: 4 });
  await frame('out-main', 'MOAK-OUT-MAIN', { main: 5 }); // in stock elsewhere only
  await frame('in', 'MOAK-IN', { site: 3 });
  await frame('same', 'MOAK-SAME', { site: 2 });
  await frame('empty', 'MOAK-EMPTY');
  await frame('not-on-site', 'MOAK-NOT-ON-SITE', { site: 1 });
  await frame('no-web-id', null, { site: 1 });
  const logged = await prisma.siteHookLog.count();

  const preview = await previewStockPush(await readSiteConnection(prisma));
  assert.equal(preview.ok, true, preview.ok ? '' : preview.message);
  if (!preview.ok) return;
  assert.equal(preview.warehouseId, SITE_WH);
  assert.deepEqual([...preview.goingOut].sort(), ['MOAK-OUT', 'MOAK-OUT-MAIN']);
  assert.deepEqual(preview.comingIn, ['MOAK-IN']);
  assert.equal(preview.unchanged, 2);
  assert.deepEqual(preview.notOnSite, ['MOAK-NOT-ON-SITE']);
  assert.equal(site.seen.length, 1);
  assert.equal(site.seen[0].method, 'GET');
  assert.equal(await prisma.siteHookLog.count(), logged);
  assert.equal(await readSiteHookHold(), null);

  await connect(site.url, { webhookSecret: 'wrong-secret' });
  const refused = await previewStockPush(await readSiteConnection(prisma));
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.message, /رمز/);
});
