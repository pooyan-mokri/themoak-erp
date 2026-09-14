import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { SITE_CONNECTION_KEY, SITE_HOOK_HOLD_KEY, SITE_HOOK_STATUS_KEY } from '@/lib/site-connection';
import { readSiteHookHold, readSiteHookStatus, type SiteHookHold, type SiteHookStatus } from '@/lib/site-hook';
import {
  disableStockPush,
  enableStockPush,
  getSiteHookAlerts,
  getSiteHookPanel,
  previewStockPush,
  releaseStockHold,
  resyncStockPush,
  retryStockPush,
  saveSiteConnection,
} from '@/actions/site-connection';
import { siteHookAlerts } from '@/components/layout/site-hook-banner';

const SECRET = 'site-webhook-secret';
const servers: Array<() => Promise<void>> = [];

// Background drains only start on production; these tests check the stored state.
delete process.env.VERCEL_ENV;

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(async () => {
  for (const close of servers) await close();
  await prisma.$disconnect();
});

type FakeSite = {
  warehouse: string | null;
  catalogue?: Array<{ webId: string; inStock: boolean }>;
  /** Answer the catalogue with this status even when the secret is right. */
  catalogueStatus?: number;
};

/** A stand-in for the website: /erp/ping names its warehouse, /erp/catalogue lists frames and their stock. */
async function fakeSite(site: FakeSite) {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const reply = (status: number, value: unknown) =>
        void res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
      if (req.method === 'POST' && req.url === '/erp/ping') {
        const want = `sha256=${createHmac('sha256', SECRET).update(body, 'utf8').digest('hex')}`;
        if (req.headers['x-erp-signature'] !== want) return reply(401, { ok: false });
        return reply(200, { ok: true, warehouse: site.warehouse, at: new Date().toISOString() });
      }
      if (req.method === 'GET' && req.url === '/erp/catalogue') {
        if (req.headers.authorization !== `Bearer ${SECRET}`) return reply(401, { ok: false });
        if (site.catalogueStatus) return reply(site.catalogueStatus, { ok: false });
        const products = site.catalogue ?? [];
        return reply(200, { ok: true, count: products.length, products });
      }
      reply(404, { ok: false });
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
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const base = { siteUrl: 'https://api.themoak.com', webhookSecret: '', paymentAccountId: 'acc-saman', warehouseId: 'wh-site' };

/** Accounts, warehouses and a saved connection to `siteUrl` with the site warehouse wh-site. */
async function setup(siteUrl = base.siteUrl) {
  await prisma.account.createMany({
    data: [
      { id: 'acc-saman', name: 'بانک سامان', type: 'BANK', currency: 'TOMAN', balance: 0 },
      { id: 'acc-other', name: 'اقتصاد نوین', type: 'BANK', currency: 'TOMAN', balance: 0 },
    ],
  });
  await prisma.warehouse.createMany({
    data: [
      { id: 'wh-site', name: 'مشاهیر' },
      { id: 'wh-other', name: 'انبار مرکزی' },
    ],
  });
  const saved = await saveSiteConnection({ ...base, siteUrl, webhookSecret: SECRET });
  assert.equal(saved.success, true, saved.message);
}

async function stored() {
  return JSON.parse((await prisma.systemSetting.findUniqueOrThrow({ where: { key: SITE_CONNECTION_KEY } })).value);
}

async function writeSetting(key: string, value: unknown) {
  const text = JSON.stringify(value);
  await prisma.systemSetting.upsert({ where: { key }, update: { value: text }, create: { key, value: text } });
}

async function switchOn() {
  await writeSetting(SITE_CONNECTION_KEY, { ...(await stored()), stockPushEnabled: true });
}

async function product(id: string, webId: string | null) {
  await prisma.product.create({ data: { id, name: `Frame ${id}`, sku: id.toUpperCase(), costPrice: 1, sellPrice: 1, webId } });
}

/** Sets the count of `productId` in the site warehouse. */
async function stock(productId: string, quantity: number) {
  await prisma.inventory.upsert({
    where: { productId_warehouseId: { productId, warehouseId: 'wh-site' } },
    update: { quantity },
    create: { productId, warehouseId: 'wh-site', quantity },
  });
}

const sorted = (values: string[] | undefined) => [...(values ?? [])].sort();

const T = '2026-09-13T08:00:00.000Z';
const PAUSED: SiteHookStatus = {
  lastRunAt: T,
  lastOkAt: null,
  failingSince: T,
  lastMessage: 'سایت رمز وبهوک را نپذیرفت؛ رمز دو طرف یکی نیست.',
  paused: { why: 'سایت رمز وبهوک را نپذیرفت؛ رمز دو طرف یکی نیست.', at: T, probedAt: T },
};
const HELD: SiteHookHold = {
  state: 'held',
  since: T,
  webIds: Array.from({ length: 12 }, (_, i) => `MOAK-FRAME-${i + 1}`),
};
const PREVIEW_CHANGED = 'موجودی یا سایت از زمان بررسی تغییر کرده؛ دوباره بررسی کنید.';

test('saving the connection keeps the stock push switch, and turns it off, clearing the hold, when the origin, the secret or the warehouse changes', async () => {
  await setup();
  await switchOn();
  await writeSetting(SITE_HOOK_STATUS_KEY, PAUSED);
  await writeSetting(SITE_HOOK_HOLD_KEY, HELD);

  for (const same of [
    base,
    { ...base, webhookSecret: SECRET },
    { ...base, siteUrl: 'https://api.themoak.com/v2/' },
    { ...base, paymentAccountId: 'acc-other' },
  ]) {
    const saved = await saveSiteConnection(same);
    assert.equal(saved.success, true, saved.message);
    assert.equal((await stored()).stockPushEnabled, true, `kept after saving ${JSON.stringify(same)}`);
  }
  assert.equal((await readSiteHookStatus()).paused, null, 'a successful save lets automatic sends run again');
  assert.deepEqual(await readSiteHookHold(), HELD, 'a save that keeps the switch on keeps the hold');

  for (const changed of [
    { ...base, siteUrl: 'https://shop.example', webhookSecret: SECRET },
    { ...base, webhookSecret: 'another-secret' },
    { ...base, warehouseId: 'wh-other' },
  ]) {
    assert.equal((await saveSiteConnection({ ...base, webhookSecret: SECRET })).success, true);
    await switchOn();
    await writeSetting(SITE_HOOK_HOLD_KEY, HELD);
    const saved = await saveSiteConnection(changed);
    assert.equal(saved.success, true, saved.message);
    assert.match(saved.message, /خاموش شد/);
    const after = await stored();
    assert.equal(after.stockPushEnabled, false, `off after saving ${JSON.stringify(changed)}`);
    assert.equal(after.warehouseId, changed.warehouseId, 'the save itself went through');
    assert.equal(await readSiteHookHold(), null, `nothing is held once off, after saving ${JSON.stringify(changed)}`);
  }
});

test('switching on asks the site for its warehouse: refused when it differs, and on a match the switch is on and every webId is queued', async () => {
  const site: FakeSite = { warehouse: 'wh-other' };
  await setup(await fakeSite(site));
  await product('a', 'MOAK-PANJ-BLUE');
  await product('b', 'MOAK-YEK-BLACK');
  await product('c', null);
  await prisma.siteHookLog.deleteMany();
  await writeSetting(SITE_HOOK_STATUS_KEY, PAUSED);

  for (const warehouse of ['wh-other', null]) {
    site.warehouse = warehouse;
    const refused = await enableStockPush([]);
    assert.equal(refused.success, false, `site warehouse ${warehouse}`);
    assert.match(refused.message, /wh-site/, 'shows the saved warehouse');
    if (warehouse) assert.match(refused.message, /wh-other/, 'shows the site warehouse');
  }
  assert.equal((await stored()).stockPushEnabled, false);
  assert.equal(await prisma.siteHookLog.count(), 0);
  assert.equal(await readSiteHookHold(), null);
  assert.deepEqual((await readSiteHookStatus()).paused, PAUSED.paused, 'a refused switch-on changes nothing');

  site.warehouse = 'wh-site';
  const before = await stored();
  const enabled = await enableStockPush([]);
  assert.equal(enabled.success, true, enabled.message);
  assert.deepEqual(await stored(), { ...before, stockPushEnabled: true }, 'every other field is kept');
  assert.equal((await readSiteHookStatus()).paused, null);
  // Not on the site and at 0 here: sent as 0 without being held.
  const hold = await readSiteHookHold();
  assert.equal(hold?.state, 'released');
  assert.deepEqual(sorted(hold?.webIds), ['MOAK-PANJ-BLUE', 'MOAK-YEK-BLACK']);
  const log = await prisma.siteHookLog.findMany({ select: { productId: true, kind: true } });
  assert.deepEqual(log.map((row: { kind: string; productId: string }) => `${row.kind}:${row.productId}`).sort(), ['resync:a', 'resync:b']);

  const off = await disableStockPush();
  assert.equal(off.success, true, off.message);
  assert.deepEqual(await stored(), { ...before, stockPushEnabled: false }, 'switching off keeps every other field');
});

test('switching off clears a hold: nothing is owed to the site while off', async () => {
  await setup();
  await switchOn();
  await writeSetting(SITE_HOOK_HOLD_KEY, HELD);

  const off = await disableStockPush();
  assert.equal(off.success, true, off.message);
  assert.equal((await stored()).stockPushEnabled, false);
  assert.equal(await readSiteHookHold(), null);
});

test('the preview and a full resync check the site again; both approve what the preview showed going out of stock, and the zeros', async () => {
  const site: FakeSite = {
    warehouse: 'wh-site',
    catalogue: [
      { webId: 'MOAK-PANJ-BLUE', inStock: true },
      { webId: 'MOAK-YEK-BLACK', inStock: false },
      { webId: 'MOAK-DO-RED', inStock: true },
    ],
  };
  await setup(await fakeSite(site));
  await product('a', 'MOAK-PANJ-BLUE');
  await product('b', 'MOAK-YEK-BLACK');
  await product('d', 'MOAK-DO-RED');
  await product('e', 'MOAK-SE-GREEN');
  await prisma.inventory.createMany({
    data: [
      { productId: 'a', warehouseId: 'wh-site', quantity: 0 },
      { productId: 'a', warehouseId: 'wh-other', quantity: 5 },
      { productId: 'b', warehouseId: 'wh-site', quantity: 3 },
      { productId: 'd', warehouseId: 'wh-site', quantity: 2 },
    ],
  });

  const preview = await previewStockPush();
  assert.equal(preview.success, true, preview.message);
  if (!preview.success) return;
  assert.equal(preview.preview.warehouseId, 'wh-site');
  assert.deepEqual(preview.preview.goingOut, ['MOAK-PANJ-BLUE']);
  assert.deepEqual(preview.preview.comingIn, ['MOAK-YEK-BLACK']);
  assert.equal(preview.preview.unchanged, 1);
  assert.deepEqual(preview.preview.notOnSite, ['MOAK-SE-GREEN']);
  const shown = preview.preview.goingOut;

  assert.equal((await resyncStockPush(shown)).success, false, 'only while switched on');
  assert.equal((await enableStockPush(shown)).success, true);
  // What the admin saw going out, and what is at 0 here but not in stock on the site, are not held.
  const approvedOnEnable = await readSiteHookHold();
  assert.equal(approvedOnEnable?.state, 'released');
  assert.deepEqual(sorted(approvedOnEnable?.webIds), ['MOAK-PANJ-BLUE', 'MOAK-SE-GREEN']);
  await prisma.siteHookLog.deleteMany();

  site.warehouse = 'wh-other';
  const refusedPreview = await previewStockPush();
  assert.equal(refusedPreview.success, false);
  assert.match(refusedPreview.message, /wh-other/);
  assert.equal((await resyncStockPush(shown)).success, false);
  assert.deepEqual(await readSiteHookHold(), approvedOnEnable, 'a refused resync approves nothing more');
  assert.equal(await prisma.siteHookLog.count(), 0);

  site.warehouse = 'wh-site';
  const resync = await resyncStockPush(shown);
  assert.equal(resync.success, true, resync.message);
  const hold = await readSiteHookHold();
  assert.equal(hold?.state, 'released');
  assert.deepEqual(sorted(hold?.webIds), ['MOAK-PANJ-BLUE', 'MOAK-SE-GREEN']);
  const log = await prisma.siteHookLog.findMany({ select: { productId: true, kind: true } });
  assert.deepEqual(log.map((row: { kind: string; productId: string }) => `${row.kind}:${row.productId}`).sort(), ['resync:a', 'resync:b', 'resync:d', 'resync:e']);
});

test('a confirmation the stock has moved on from is refused: switching on and a resync write nothing until the admin checks again', async () => {
  const site: FakeSite = {
    warehouse: 'wh-site',
    catalogue: [
      { webId: 'MOAK-PANJ-BLUE', inStock: true },
      { webId: 'MOAK-YEK-BLACK', inStock: true },
      { webId: 'MOAK-DO-RED', inStock: true },
    ],
  };
  await setup(await fakeSite(site));
  await product('a', 'MOAK-PANJ-BLUE');
  await product('b', 'MOAK-YEK-BLACK');
  await product('d', 'MOAK-DO-RED');
  await stock('a', 0);
  await stock('b', 2);
  await stock('d', 1);
  await writeSetting(SITE_HOOK_STATUS_KEY, PAUSED);

  const checked = await previewStockPush();
  assert.equal(checked.success, true, checked.message);
  if (!checked.success) return;
  assert.deepEqual(checked.preview.goingOut, ['MOAK-PANJ-BLUE']);

  // The last YEK is sold after the admin looked: one more frame would go out of stock.
  await stock('b', 0);
  await prisma.siteHookLog.deleteMany();
  const refused = await enableStockPush(checked.preview.goingOut);
  assert.equal(refused.success, false);
  assert.equal(refused.message, PREVIEW_CHANGED);
  assert.equal((await stored()).stockPushEnabled, false, 'still off');
  assert.equal(await readSiteHookHold(), null, 'nothing approved before the refusal');
  for (const malformed of [undefined, 'MOAK-PANJ-BLUE', [1]]) {
    const result = await enableStockPush(malformed as any);
    assert.equal(result.success, false, `refuses ${JSON.stringify(malformed)}`);
    assert.equal((await resyncStockPush(malformed as any)).success, false, `resync refuses ${JSON.stringify(malformed)}`);
  }
  // A hold waiting on frames this preview does not send as 0 has to be released or fixed first.
  await writeSetting(SITE_HOOK_HOLD_KEY, HELD);
  const waiting = await enableStockPush(['MOAK-PANJ-BLUE', 'MOAK-YEK-BLACK']);
  assert.equal(waiting.success, false);
  assert.match(waiting.message, /آزاد کنید/);
  assert.equal((await stored()).stockPushEnabled, false);
  assert.deepEqual(await readSiteHookHold(), HELD);
  assert.deepEqual(await readSiteHookStatus(), PAUSED);
  assert.equal(await prisma.siteHookLog.count(), 0);
  await prisma.systemSetting.delete({ where: { key: SITE_HOOK_HOLD_KEY } });

  const again = await previewStockPush();
  assert.equal(again.success, true, again.message);
  if (!again.success) return;
  assert.deepEqual(sorted(again.preview.goingOut), ['MOAK-PANJ-BLUE', 'MOAK-YEK-BLACK']);
  // A list naming a frame no longer going out is fine; only what goes out now is approved.
  const enabled = await enableStockPush([...again.preview.goingOut, 'MOAK-DO-RED']);
  assert.equal(enabled.success, true, enabled.message);
  assert.equal((await stored()).stockPushEnabled, true);
  const approved = await readSiteHookHold();
  assert.deepEqual(sorted(approved?.webIds), ['MOAK-PANJ-BLUE', 'MOAK-YEK-BLACK']);

  // The same for a resync, while switched on.
  await stock('d', 0);
  await prisma.siteHookLog.deleteMany();
  const stale = await resyncStockPush(again.preview.goingOut);
  assert.equal(stale.success, false);
  assert.equal(stale.message, PREVIEW_CHANGED);
  assert.deepEqual(await readSiteHookHold(), approved);
  assert.equal(await prisma.siteHookLog.count(), 0);
  const resync = await resyncStockPush([...again.preview.goingOut, 'MOAK-DO-RED']);
  assert.equal(resync.success, true, resync.message);
  assert.deepEqual(sorted((await readSiteHookHold())?.webIds), ['MOAK-DO-RED', 'MOAK-PANJ-BLUE', 'MOAK-YEK-BLACK']);
});

test('switching on is refused, and stays off, when the site refuses the catalogue', async () => {
  await setup(await fakeSite({ warehouse: 'wh-site', catalogue: [], catalogueStatus: 401 }));
  await product('a', 'MOAK-PANJ-BLUE');
  await prisma.siteHookLog.deleteMany();
  await writeSetting(SITE_HOOK_STATUS_KEY, PAUSED);

  const refused = await enableStockPush([]);
  assert.equal(refused.success, false);
  assert.match(refused.message, /«رمز وبهوک» را با پنل سایت مقایسه کنید/, 'the catalogue refusal, after the ping passed');
  assert.equal((await stored()).stockPushEnabled, false);
  assert.equal(await readSiteHookHold(), null);
  assert.deepEqual(await readSiteHookStatus(), PAUSED);
  assert.equal(await prisma.siteHookLog.count(), 0);
});

test('every stock push action refuses anyone but an admin, and changes nothing', async () => {
  const site: FakeSite = { warehouse: 'wh-site', catalogue: [] };
  await setup(await fakeSite(site));
  await product('a', 'MOAK-PANJ-BLUE');
  await prisma.siteHookLog.deleteMany();
  await writeSetting(SITE_HOOK_HOLD_KEY, HELD);
  await writeSetting(SITE_HOOK_STATUS_KEY, PAUSED);
  await switchOn();
  const connection = await stored();

  const actions: Record<string, () => Promise<{ success: boolean; message: string }>> = {
    getSiteHookPanel,
    previewStockPush,
    enableStockPush: () => enableStockPush([]),
    disableStockPush,
    resyncStockPush: () => resyncStockPush([]),
    releaseStockHold: () => releaseStockHold(HELD.webIds),
    retryStockPush,
  };
  for (const role of ['USER', 'WAREHOUSE', null]) {
    setTestRole(role);
    for (const [name, action] of Object.entries(actions)) {
      const result = await action();
      assert.equal(result.success, false, `${name} as ${role}`);
      assert.match(result.message, /فقط مدیر/);
      assert.deepEqual(Object.keys(result).sort(), ['message', 'success'], `${name} as ${role} returns nothing else`);
    }
    assert.deepEqual(await getSiteHookAlerts(), [], `no alerts for ${role}`);
  }
  assert.deepEqual(await stored(), connection);
  assert.deepEqual(await readSiteHookHold(), HELD);
  assert.deepEqual(await readSiteHookStatus(), PAUSED);
  assert.equal(await prisma.siteHookLog.count(), 0);
});

test('releasing the hold and retrying change the stored state', async () => {
  await setup();
  await switchOn();
  await writeSetting(SITE_HOOK_HOLD_KEY, HELD);
  await writeSetting(SITE_HOOK_STATUS_KEY, PAUSED);

  const released = await releaseStockHold([...HELD.webIds].reverse());
  assert.equal(released.success, true, released.message);
  assert.match(released.message, /موجودی فعلی/);
  assert.deepEqual(await readSiteHookHold(), { ...HELD, state: 'released' });
  assert.deepEqual((await readSiteHookStatus()).paused, PAUSED.paused, 'releasing does not lift the pause');
  assert.equal((await releaseStockHold(HELD.webIds)).success, false, 'a released hold is not released again');

  const retried = await retryStockPush();
  assert.equal(retried.success, true, retried.message);
  assert.deepEqual(
    await readSiteHookStatus(),
    { ...PAUSED, paused: null, failingSince: null },
    'the pause and the old failure date are lifted; the rest of the status stays',
  );
});

test('releasing is refused when the held list changed after the page read it', async () => {
  await setup();
  await switchOn();
  await writeSetting(SITE_HOOK_HOLD_KEY, HELD);
  const panel = await getSiteHookPanel();
  assert.equal(panel.success, true, panel.message);
  if (!panel.success) return;
  const shown = panel.hold?.webIds ?? [];
  assert.equal(shown.length, 12);

  // A drain holds one more frame after the page was read...
  const grown: SiteHookHold = { ...HELD, webIds: [...HELD.webIds, 'MOAK-FRAME-13'] };
  await writeSetting(SITE_HOOK_HOLD_KEY, grown);
  const refused = await releaseStockHold(shown);
  assert.equal(refused.success, false);
  assert.equal(refused.message, 'فهرست نگه‌داشته تغییر کرده؛ صفحه را تازه کنید.');
  assert.deepEqual(await readSiteHookHold(), grown);

  // ...or sends one whose count was fixed in the ERP.
  const shrunk: SiteHookHold = { ...HELD, webIds: HELD.webIds.slice(1) };
  await writeSetting(SITE_HOOK_HOLD_KEY, shrunk);
  assert.equal((await releaseStockHold(shown)).success, false);
  for (const malformed of [undefined, shrunk.webIds.join(','), [1]]) {
    assert.equal((await releaseStockHold(malformed as any)).success, false, `refuses ${JSON.stringify(malformed)}`);
  }
  assert.deepEqual(await readSiteHookHold(), shrunk);

  const released = await releaseStockHold(shrunk.webIds);
  assert.equal(released.success, true, released.message);
  assert.deepEqual(await readSiteHookHold(), { ...shrunk, state: 'released' });
});

test('the panel shows the switch, status, hold, refused webIds and the unsent changes', async () => {
  await setup();
  await switchOn();
  await writeSetting(SITE_HOOK_HOLD_KEY, HELD);
  await writeSetting(SITE_HOOK_STATUS_KEY, PAUSED);
  await prisma.siteHookState.createMany({
    data: [
      { webId: 'MOAK-PANJ-BLUE', quantity: 3, sentAt: new Date(T) },
      { webId: 'MOAK-YEK-BLACK', quantity: 1, skipWhy: 'unknown webId', skipAt: new Date('2026-09-13T09:00:00.000Z') },
    ],
  });
  await prisma.siteHookLog.deleteMany();
  await prisma.siteHookLog.createMany({
    data: [
      { productId: 'a', kind: 'stock', warehouseId: 'wh-site', createdAt: new Date('2026-09-13T07:30:00.000Z') },
      { productId: 'b', kind: 'resync', createdAt: new Date('2026-09-13T07:00:00.000Z') },
    ],
  });

  const panel = await getSiteHookPanel();
  assert.equal(panel.success, true, panel.message);
  if (!panel.success) return;
  assert.equal(panel.enabled, true);
  assert.deepEqual(panel.status, PAUSED);
  assert.deepEqual(panel.hold, HELD);
  assert.deepEqual(panel.skipped, [{ webId: 'MOAK-YEK-BLACK', why: 'unknown webId', at: '2026-09-13T09:00:00.000Z' }]);
  assert.equal(panel.pending, 2);
  assert.equal(panel.oldestPendingAt, '2026-09-13T07:00:00.000Z');
});

test('the banner alerts, read afresh: nothing for anyone but an admin; for an admin the hold, the pause, and changes waiting over 30 minutes', async () => {
  await setup();
  await prisma.siteHookLog.deleteMany();
  const waitingFor = (minutes: number) =>
    prisma.siteHookLog.create({
      data: { productId: 'a', kind: 'stock', warehouseId: 'wh-site', createdAt: new Date(Date.now() - minutes * 60_000) },
    });
  await waitingFor(45);
  await writeSetting(SITE_HOOK_HOLD_KEY, HELD);
  await writeSetting(SITE_HOOK_STATUS_KEY, PAUSED);
  assert.deepEqual(await getSiteHookAlerts(), [], 'nothing while switched off');

  await switchOn();
  for (const role of ['USER', 'WAREHOUSE', null]) {
    setTestRole(role);
    assert.deepEqual(await getSiteHookAlerts(), [], `nothing for ${role}`);
  }
  setTestRole('ADMIN');

  const both = await getSiteHookAlerts();
  assert.equal(both.length, 2, 'the hold and the pause already explain the waiting changes');
  assert.match(both[0], /۱۲ فریم/);
  assert.match(both[1], /متوقف/);

  await prisma.systemSetting.delete({ where: { key: SITE_HOOK_STATUS_KEY } });
  const held = await getSiteHookAlerts();
  assert.equal(held.length, 1);
  assert.match(held[0], /۱۲ فریم/);

  await writeSetting(SITE_HOOK_STATUS_KEY, PAUSED);
  await prisma.systemSetting.delete({ where: { key: SITE_HOOK_HOLD_KEY } });
  const paused = await getSiteHookAlerts();
  assert.equal(paused.length, 1);
  assert.match(paused[0], /متوقف/);

  await prisma.systemSetting.delete({ where: { key: SITE_HOOK_STATUS_KEY } });
  await writeSetting(SITE_HOOK_HOLD_KEY, { ...HELD, state: 'released' });
  const stale = await getSiteHookAlerts();
  assert.equal(stale.length, 1, 'a released hold waits for nobody, so it explains nothing');
  assert.match(stale[0], /۴۵ دقیقه/);
  assert.match(stale[0], /به سایت نرسیده/);

  await prisma.siteHookLog.deleteMany();
  await waitingFor(29);
  assert.deepEqual(await getSiteHookAlerts(), [], 'changes waiting under 30 minutes are not alerted');

  // No hold or pause to hide it: only the switch keeps old changes from being alerted.
  await prisma.siteHookLog.deleteMany();
  await waitingFor(45);
  await writeSetting(SITE_CONNECTION_KEY, { ...(await stored()), stockPushEnabled: false });
  assert.deepEqual(await getSiteHookAlerts(), [], 'nothing while switched off, however old the changes');
});

test('siteHookAlerts alerts on a hold, a pause, or failures older than 30 minutes, and says nothing otherwise', () => {
  const now = Date.parse('2026-09-13T10:00:00.000Z');
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const ok: SiteHookStatus = { lastRunAt: ago(1), lastOkAt: ago(1), failingSince: null, paused: null, lastMessage: null };
  const paused: SiteHookStatus = { ...PAUSED, failingSince: ago(90), paused: { ...PAUSED.paused!, at: ago(90), probedAt: ago(5) } };

  assert.deepEqual(siteHookAlerts({ enabled: true, status: ok, hold: null }, now), []);
  assert.deepEqual(siteHookAlerts({ enabled: true, status: null, hold: null }, now), []);
  assert.deepEqual(siteHookAlerts({ enabled: true, status: ok, hold: { ...HELD, state: 'released' } }, now), [], 'released frames wait for nobody');

  const held = siteHookAlerts({ enabled: true, status: ok, hold: HELD }, now);
  assert.equal(held.length, 1);
  assert.match(held[0], /۱۲ فریم/);
  assert.match(held[0], /تأیید/);

  const pause = siteHookAlerts({ enabled: true, status: paused, hold: null }, now);
  assert.equal(pause.length, 1, 'a pause is not reported a second time as a failure');
  assert.match(pause[0], /متوقف/);
  assert.match(pause[0], /رمز وبهوک را نپذیرفت/);

  const failing = siteHookAlerts({ enabled: true, status: { ...ok, failingSince: ago(31), lastMessage: 'پاسخ سایت نرسید (timeout).' }, hold: null }, now);
  assert.equal(failing.length, 1);
  assert.match(failing[0], /۳۱ دقیقه/);
  assert.match(failing[0], /timeout/);
  assert.deepEqual(siteHookAlerts({ enabled: true, status: { ...ok, failingSince: ago(29) }, hold: null }, now), [], 'a short failure is not alerted');

  assert.equal(siteHookAlerts({ enabled: true, status: paused, hold: HELD }, now).length, 2);
  assert.deepEqual(siteHookAlerts({ enabled: false, status: paused, hold: HELD }, now), [], 'nothing is sent while switched off');
});
