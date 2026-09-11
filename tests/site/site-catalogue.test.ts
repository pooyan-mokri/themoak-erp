import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { fetchSiteCatalogue, parseCatalogue, planCatalogueSync } from '@/lib/site-catalogue';
import { runCatalogueSync } from '@/lib/site-catalogue-sync';
import { SITE_CONNECTION_KEY, SITE_CATALOGUE_SYNC_KEY, normalizeSiteUrl } from '@/lib/site-connection';
import { updateProduct } from '@/actions/product';
import { form } from '../helpers/db';
import {
  getSiteConnectionForm,
  saveSiteConnection,
  syncSiteCatalogue,
  testSiteConnection,
} from '@/actions/site-connection';
import { GET as cronGET } from '@/app/api/site/catalogue-sync/route';
import { getSetting, saveSetting } from '@/actions/settings';

const SECRET = 'site-webhook-secret';
const servers: Array<() => Promise<void>> = [];

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(async () => {
  for (const close of servers) await close();
  await prisma.$disconnect();
});

/** A stand-in for the website, on a random local port. */
async function fakeSite(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  servers.push(close);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function catalogue(products: unknown[]) {
  return (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== '/erp/catalogue') return void res.writeHead(404).end();
    if (req.headers.authorization !== `Bearer ${SECRET}`) {
      return void res.writeHead(401, { 'content-type': 'application/json' }).end('{"ok":false}');
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, count: products.length, products }));
  };
}

const img = (slug: string) => `https://themoak.com/media/products/${slug}-front.webp`;
const page = (slug: string) => `https://themoak.com/shop/eyewear/${slug}`;

async function connect(siteUrl: string, secret = SECRET) {
  const value = JSON.stringify({ siteUrl, webhookSecret: secret, paymentAccountId: null, warehouseId: null });
  await prisma.systemSetting.upsert({ where: { key: SITE_CONNECTION_KEY }, update: { value }, create: { key: SITE_CONNECTION_KEY, value } });
}

async function product(id: string, name: string, webId: string | null, imageUrl: string | null = null) {
  return prisma.product.create({ data: { id, name, sku: id.toUpperCase(), costPrice: 1, sellPrice: 1, webId, imageUrl } });
}

test('the image sync never touches a product without a webId, even one whose name and sku match the site', async () => {
  await product('a', 'DAMN RAW - White', 'MOAK-DAMN-RAW-WHITE');
  // Same name as the site entry, and a SKU equal to its webId (the site sends sku = webId).
  const noWebId = await prisma.product.create({
    data: { id: 'b', name: 'DAMN LURKING - Grey', sku: 'MOAK-DAMN-LURKING-GREY', costPrice: 1, sellPrice: 1, imageUrl: 'https://old.example/b.webp' },
  });
  await connect(
    await fakeSite(
      catalogue([
        { webId: 'MOAK-DAMN-RAW-WHITE', sku: 'MOAK-DAMN-RAW-WHITE', name: 'DAMN RAW - White', image: img('damn-raw-white'), url: page('damn-raw-white') },
        { webId: 'MOAK-DAMN-LURKING-GREY', sku: 'MOAK-DAMN-LURKING-GREY', name: 'DAMN LURKING - Grey', image: img('damn-lurking-grey'), url: page('damn-lurking-grey') },
      ]),
    ),
  );

  const result = await runCatalogueSync(prisma);
  assert.equal(result.ok, true, result.message);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: 'a' } })).imageUrl, img('damn-raw-white'), 'the sync did run');

  const untouched = await prisma.product.findUniqueOrThrow({ where: { id: 'b' } });
  assert.equal(untouched.imageUrl, 'https://old.example/b.webp');
  assert.equal(untouched.siteUrl, null);
  assert.equal(untouched.updatedAt.getTime(), noWebId.updatedAt.getTime(), 'the row must not even be written');
  assert.deepEqual(result.notInErp, ['MOAK-DAMN-LURKING-GREY']);
});

test('sync stores photo and page link by webId, reports what did not match, and a second run changes nothing', async () => {
  await product('a', 'PANJ - Blue', 'MOAK-PANJ-BLUE');
  await product('c', 'YEK - Black', 'MOAK-YEK-BLACK');
  await connect(
    await fakeSite(
      catalogue([
        { webId: 'MOAK-PANJ-BLUE', image: img('panj-blue'), url: page('panj-blue') },
        { webId: 'MOAK-DAMN-RAW-WHITE', image: img('damn-raw-white'), url: page('damn-raw-white') },
      ]),
    ),
  );

  const first = await runCatalogueSync(prisma);
  assert.equal(first.ok, true, first.message);
  assert.equal(first.read, 2);
  assert.equal(first.updated, 1);
  assert.deepEqual(first.notInErp, ['MOAK-DAMN-RAW-WHITE']);
  assert.deepEqual(first.notOnSite, ['MOAK-YEK-BLACK']);
  const a = await prisma.product.findUniqueOrThrow({ where: { id: 'a' } });
  assert.equal(a.imageUrl, img('panj-blue'));
  assert.equal(a.siteUrl, page('panj-blue'));

  const saved = await prisma.systemSetting.findUniqueOrThrow({ where: { key: SITE_CATALOGUE_SYNC_KEY } });
  assert.equal(JSON.parse(saved.value).updated, 1);

  const second = await runCatalogueSync(prisma);
  assert.equal(second.updated, 0);
  assert.equal(second.unchanged, 1);
});

test('a missing or relative photo on the site never blanks one the ERP already shows', () => {
  const parsed = parseCatalogue({ products: [{ webId: 'MOAK-PANJ-BLUE', image: '/media/relative.webp', url: null }] });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.items[0].image, null, 'a relative URL is not usable in <img>');
  const plan = planCatalogueSync(parsed.items, [
    { id: 'a', webId: 'MOAK-PANJ-BLUE', imageUrl: img('panj-blue'), siteUrl: page('panj-blue') },
  ]);
  assert.equal(plan.updates.length, 0);
  assert.equal(plan.unchanged, 1);
});

test('entries without a valid webId, and webIds listed twice, are skipped and reported', () => {
  const parsed = parseCatalogue({
    products: [
      { webId: 'MOAK-PANJ-BLUE', image: img('panj-blue') },
      { slug: 'no-web-id', image: img('x') },
      { webId: 'moak-lower', image: img('y') },
      { webId: 'MOAK-DUP', image: img('d1') },
      { webId: 'MOAK-DUP', image: img('d2') },
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.items.map((i) => i.webId), ['MOAK-PANJ-BLUE']);
  assert.equal(parsed.skipped.length, 4);
  assert.equal(parseCatalogue({ nope: true }).ok, false);
});

test('a wrong secret is reported in words, and nothing is written', async () => {
  await product('a', 'PANJ - Blue', 'MOAK-PANJ-BLUE');
  await connect(await fakeSite(catalogue([{ webId: 'MOAK-PANJ-BLUE', image: img('panj-blue') }])), 'wrong-secret');
  const result = await runCatalogueSync(prisma);
  assert.equal(result.ok, false);
  assert.match(result.message, /رمز/);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: 'a' } })).imageUrl, null);
});

test('a wrong address, a dead address and a site that never answers each give a readable message', async () => {
  const messageOf = async (siteUrl: string, timeoutMs?: number) => {
    const result = await fetchSiteCatalogue({ siteUrl, secret: SECRET, timeoutMs });
    assert.equal(result.ok, false);
    return result.ok ? '' : result.message;
  };
  assert.match(await messageOf(await fakeSite((_req, res) => void res.writeHead(404).end())), /پیدا نشد/);
  assert.match(await messageOf('http://127.0.0.1:9'), /وصل نشد/);
  assert.match(await messageOf(await fakeSite(() => {}), 300), /زمان مقرر/); // accepts, never replies
});

test('sync without saved settings says so and touches no product', async () => {
  const before = await product('a', 'PANJ - Blue', 'MOAK-PANJ-BLUE');
  const result = await runCatalogueSync(prisma);
  assert.equal(result.ok, false);
  assert.match(result.message, /ثبت نشده/);
  const after = await prisma.product.findUniqueOrThrow({ where: { id: 'a' } });
  assert.equal(after.imageUrl, null);
  assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
});

async function accountsAndWarehouses() {
  await prisma.account.createMany({
    data: [
      { id: 'acc-saman', name: 'بانک سامان', type: 'BANK', currency: 'TOMAN', balance: 0 },
      { id: 'acc-other', name: 'اقتصاد نوین', type: 'BANK', currency: 'TOMAN', balance: 0 },
      { id: 'acc-exp', name: 'Marketing Expenses', type: 'EXPENSE', currency: 'TOMAN', balance: 0 },
    ],
  });
  await prisma.warehouse.createMany({
    data: [
      { id: 'wh-mashahir', name: 'مشاهیر' },
      { id: 'wh-main', name: 'انبار مرکزی' },
      { id: 'wh-old', name: 'انبار قدیمی', isArchived: true },
      { id: 'wh-partner', name: 'انبار همکار', isVirtual: true },
    ],
  });
}

test('the settings form never carries the secret, and preselects بانک سامان and مشاهیر', async () => {
  await accountsAndWarehouses();
  const blank = await getSiteConnectionForm();
  assert.equal(blank.paymentAccountId, 'acc-saman');
  assert.equal(blank.warehouseId, 'wh-mashahir');
  assert.deepEqual(blank.accounts.map((a) => a.id).sort(), ['acc-other', 'acc-saman']);
  assert.deepEqual(blank.warehouses.map((w) => w.id).sort(), ['wh-main', 'wh-mashahir']);

  const saved = await saveSiteConnection({
    siteUrl: 'api.themoak.com/',
    webhookSecret: SECRET,
    paymentAccountId: 'acc-other',
    warehouseId: 'wh-main',
  });
  assert.equal(saved.success, true, saved.message);
  const form = await getSiteConnectionForm();
  assert.equal(form.siteUrl, 'https://api.themoak.com');
  assert.equal(form.hasSecret, true);
  assert.equal(form.paymentAccountId, 'acc-other');
  assert.equal(form.warehouseId, 'wh-main');
  assert.equal(JSON.stringify(form).includes(SECRET), false, 'the secret must never reach the browser');
});

test('an empty secret keeps the saved one; bad choices and non-admins are refused', async () => {
  await accountsAndWarehouses();
  const base = { siteUrl: 'https://api.themoak.com', paymentAccountId: 'acc-saman', warehouseId: 'wh-mashahir' };
  assert.equal((await saveSiteConnection({ ...base, webhookSecret: '' })).success, false, 'no secret yet');
  assert.equal((await saveSiteConnection({ ...base, webhookSecret: SECRET })).success, true);
  assert.equal((await saveSiteConnection({ ...base, webhookSecret: '   ' })).success, true);
  const stored = JSON.parse((await prisma.systemSetting.findUniqueOrThrow({ where: { key: SITE_CONNECTION_KEY } })).value);
  assert.equal(stored.webhookSecret, SECRET);

  assert.equal((await saveSiteConnection({ ...base, webhookSecret: '', paymentAccountId: 'acc-exp' })).success, false);
  assert.equal((await saveSiteConnection({ ...base, webhookSecret: '', warehouseId: 'wh-old' })).success, false);
  assert.equal((await saveSiteConnection({ ...base, webhookSecret: '', warehouseId: 'wh-partner' })).success, false);
  assert.equal((await saveSiteConnection({ ...base, webhookSecret: '', siteUrl: 'ftp://nope' })).success, false);

  setTestRole('USER');
  assert.equal((await saveSiteConnection({ ...base, webhookSecret: 'x' })).success, false);
  assert.equal((await syncSiteCatalogue()).ok, false);
  await assert.rejects(() => getSiteConnectionForm());
});

test('test connection reports the catalogue size and writes nothing', async () => {
  await product('a', 'PANJ - Blue', 'MOAK-PANJ-BLUE');
  await connect(await fakeSite(catalogue([{ webId: 'MOAK-PANJ-BLUE', image: img('panj-blue') }])));
  const result = await testSiteConnection();
  assert.equal(result.success, true, result.message);
  assert.match(result.message, /۱ کالا/);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: 'a' } })).imageUrl, null);
  assert.equal(await prisma.systemSetting.findUnique({ where: { key: SITE_CATALOGUE_SYNC_KEY } }), null);
});

test('the daily cron route refuses without the right CRON_SECRET, and runs the sync with it', async () => {
  await product('a', 'PANJ - Blue', 'MOAK-PANJ-BLUE');
  await connect(await fakeSite(catalogue([{ webId: 'MOAK-PANJ-BLUE', image: img('panj-blue') }])));
  const call = (authorization?: string) =>
    cronGET(new NextRequest('http://localhost/api/site/catalogue-sync', { headers: authorization ? { authorization } : {} }));

  delete process.env.CRON_SECRET;
  assert.equal((await call('Bearer undefined')).status, 401, 'unset CRON_SECRET must refuse everything');

  process.env.CRON_SECRET = 'cron-test-secret';
  assert.equal((await call()).status, 401);
  assert.equal((await call('Bearer wrong')).status, 401);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: 'a' } })).imageUrl, null);

  const ok = await call('Bearer cron-test-secret');
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).updated, 1);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: 'a' } })).imageUrl, img('panj-blue'));
});

test('the generic, browser-reachable settings actions can neither read nor overwrite the site connection', async () => {
  await connect('https://api.themoak.com');
  assert.equal(await getSetting(SITE_CONNECTION_KEY), undefined);
  const attempt = await saveSetting(SITE_CONNECTION_KEY, { siteUrl: 'https://attacker.example', webhookSecret: 'x' });
  assert.equal(attempt.success, false);
  const stored = JSON.parse((await prisma.systemSetting.findUniqueOrThrow({ where: { key: SITE_CONNECTION_KEY } })).value);
  assert.equal(stored.siteUrl, 'https://api.themoak.com');
  assert.equal(stored.webhookSecret, SECRET);
});

test('changing or clearing a webId drops the old frame\'s photo, and the next sync gives it to the right product', async () => {
  await product('a', 'DAMN RAW - White', 'MOAK-DAMN-RAW-WHITE');
  await product('b', 'DAMN RAW - White (new stock)', null);
  await connect(await fakeSite(catalogue([{ webId: 'MOAK-DAMN-RAW-WHITE', image: img('damn-raw-white'), url: page('damn-raw-white') }])));
  await runCatalogueSync(prisma);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: 'a' } })).imageUrl, img('damn-raw-white'));

  const fields = { productType: 'SALEABLE', costPrice: '1', sellPrice: '1' };
  const cleared = await updateProduct('a', {} as any, form({ ...fields, name: 'DAMN RAW - White', sku: 'A', webId: '', confirmWebIdChange: '1' }));
  assert.equal(cleared.success, true, String(cleared.message));
  const a = await prisma.product.findUniqueOrThrow({ where: { id: 'a' } });
  assert.equal(a.webId, null);
  assert.equal(a.imageUrl, null, 'no longer that frame, so no longer its photo');
  assert.equal(a.siteUrl, null);

  const moved = await updateProduct('b', {} as any, form({ ...fields, name: 'DAMN RAW - White (new stock)', sku: 'B', webId: 'MOAK-DAMN-RAW-WHITE' }));
  assert.equal(moved.success, true, String(moved.message));
  await runCatalogueSync(prisma);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: 'b' } })).imageUrl, img('damn-raw-white'));
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: 'a' } })).imageUrl, null);
});

test('the saved secret is never sent to a different site without typing it again', async () => {
  await accountsAndWarehouses();
  const base = { paymentAccountId: 'acc-saman', warehouseId: 'wh-mashahir' };
  assert.equal((await saveSiteConnection({ ...base, siteUrl: 'https://api.themoak.com', webhookSecret: SECRET })).success, true);

  const moved = await saveSiteConnection({ ...base, siteUrl: 'https://attacker.example', webhookSecret: '' });
  assert.equal(moved.success, false);
  assert.match(moved.message, /دوباره وارد کنید/);
  const stored = JSON.parse((await prisma.systemSetting.findUniqueOrThrow({ where: { key: SITE_CONNECTION_KEY } })).value);
  assert.equal(stored.siteUrl, 'https://api.themoak.com');

  // Same site, different path: still the same origin, so the saved secret may stay.
  assert.equal((await saveSiteConnection({ ...base, siteUrl: 'https://api.themoak.com/v2', webhookSecret: '' })).success, true);
  // A new site with a newly typed secret is fine.
  assert.equal((await saveSiteConnection({ ...base, siteUrl: 'https://shop.example', webhookSecret: 'new-secret' })).success, true);
});

test('only addresses that cannot leak the secret are accepted as the site address', () => {
  assert.equal(normalizeSiteUrl('api.themoak.com/'), 'https://api.themoak.com');
  assert.equal(normalizeSiteUrl(' https://api.themoak.com/base/ '), 'https://api.themoak.com/base');
  assert.equal(normalizeSiteUrl('http://localhost:3000/'), 'http://localhost:3000');
  for (const bad of [
    'http://api.themoak.com',
    'https://api.themoak.com@evil.example',
    'https://user:pass@api.themoak.com',
    'https://api.themoak.com/?next=https://evil.example',
    'https://api.themoak.com/#',
    'ftp://api.themoak.com',
    'javascript://alert(1)',
    '',
  ]) {
    assert.equal(normalizeSiteUrl(bad), null, `should refuse ${JSON.stringify(bad)}`);
  }
});

test('a site that sends headers but stalls on the body is reported as a timeout', async () => {
  const stalls = await fakeSite((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"ok":true,"products":['); // and never finishes
  });
  const result = await fetchSiteCatalogue({ siteUrl: stalls, secret: SECRET, timeoutMs: 300 });
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.message, /زمان مقرر/);
});
