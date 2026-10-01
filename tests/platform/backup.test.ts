import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { Client } from 'basic-ftp';
import { NextRequest } from 'next/server';
import { fakeFtp, FTP_SETTINGS } from './fake-ftp';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { seedShop, PRICE } from '../orders/seed';
import { createOrder } from '@/actions/sales';
import { buildDatabaseDump, isBackupDue, runBackup, BACKUP_FOLDER } from '@/lib/db-backup';
import { createBackup, getBackupSettings, getLastBackup, listBackups, saveBackupSettings } from '@/actions/backup';
import { GET as download } from '@/app/api/backups/[filename]/route';
import { GET as scheduled } from '@/app/api/cron/backup/route';
import { readSystemSetting } from '@/lib/system-settings';

// The FTP and backup code logs the failures these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  fakeFtp.reset();
  await resetDatabase();
});
after(() => prisma.$disconnect());

const withFtp = () => prisma.systemSetting.create({ data: { key: 'ftp_credentials', value: JSON.stringify(FTP_SETTINGS) } });
const backupFiles = () => [...fakeFtp.files.keys()].filter((path) => path.startsWith(`${BACKUP_FOLDER}/`)).sort();
const oldBackup = (stamp: string) => fakeFtp.files.set(`${BACKUP_FOLDER}/backup-${stamp}.sql`, Buffer.from(`-- ${stamp}`));

// ---------------------------------------------------------------- the dump

/** Every kind of value the ERP stores: money in toman and dollars, Persian text, quotes, arrays, JSON, big ids. */
async function seedEverything() {
  await prisma.user.create({ data: { id: 'test-user', name: "O'Brien «مدیر»", email: 'admin@example.com', password: '$2a$10$abc', role: 'ADMIN' } });
  const shop = await seedShop();
  setTestRole('SALES');
  const sale = await createOrder({
    customerId: shop.customer.id,
    items: [{ productId: shop.product.id, quantity: 2, price: PRICE }],
    paymentMethod: 'ACCOUNT',
    accountId: shop.saman.id,
    totalAmount: 2 * PRICE,
    paidAmount: PRICE + 0.5,
    warehouseId: shop.warehouse.id,
    tags: ['vip', 'quote " and \\ backslash', 'با فاصله; DROP TABLE "Order";'],
  });
  assert.equal(sale.success, true, sale.message);
  setTestRole('ADMIN');
  await prisma.customer.create({ data: { name: "line one\nline two\ttab 'quoted' \"double\" 🕶️", phone: '۰۹۱۲۱۲۳۴۵۶۷' } });
  await prisma.account.update({ where: { id: shop.usd.id }, data: { balance: 1234.56 } });
  await prisma.product.update({ where: { id: shop.product.id }, data: { costPrice: '3999999.9999', webId: 'MOAK-1' } });
  const conversation = await prisma.aIConversation.create({ data: { userId: 'test-user', title: 'مکالمه' } });
  const message = await prisma.aIMessage.create({
    data: { conversationId: conversation.id, role: 'USER', content: 'سلام', metadata: { usage: { tokens: [1, 2, 3] }, nested: { ok: true, none: null } } },
  });
  await prisma.aIAction.create({ data: { messageId: message.id, action: 'search_products', parameters: { query: "it's" }, success: true } });
  await prisma.systemSetting.create({ data: { key: 'company_info', value: JSON.stringify({ name: 'دِ موک', address: "Tehran's" }) } });
  const project = await prisma.project.create({ data: { name: 'P', budget: '12345678901234.5', startDate: new Date('2026-09-22T20:30:00.123Z') } });
  await prisma.task.create({ data: { title: 'T', projectId: project.id, assignedTo: 'test-user' } });
  return shop;
}

type Fingerprint = Record<string, { rows: number; hash: string }>;

/**
 * Every table's row count and a hash of all its rows: equal only when the content is identical. Rows are
 * hashed as JSON, keyed by column name, so a database whose columns were added in another order (production,
 * grown by deploys) fingerprints the same as a fresh one.
 */
async function fingerprint(client: PrismaClient): Promise<Fingerprint> {
  const tables: Array<{ name: string }> = await client.$queryRawUnsafe(
    `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`,
  );
  const result: Fingerprint = {};
  for (const { name } of tables) {
    const [row]: Array<{ rows: number; hash: string }> = await client.$queryRawUnsafe(
      `SELECT count(*)::int AS rows, coalesce(md5(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text)), '') AS hash FROM "${name}" t`,
    );
    result[name] = row;
  }
  return result;
}

const money = (client: PrismaClient) =>
  client.$queryRawUnsafe(`SELECT
    (SELECT sum(balance)::text FROM "Account") AS balances,
    (SELECT sum(amount)::text FROM "Transaction") AS amounts,
    (SELECT sum("amountInToman")::text FROM "Transaction") AS toman,
    (SELECT sum(quantity)::text FROM "Inventory") AS stock,
    (SELECT sum("totalAmount")::text || '/' || sum("paidAmount")::text FROM "Order") AS orders`);

const PSQL = process.env.PSQL ?? '/usr/local/opt/postgresql@17/bin/psql';

test('a backup restores into an empty database with every row, sum and counter identical', { skip: !existsSync(PSQL) && `no psql at ${PSQL}` }, async () => {
  await seedEverything();
  const dump = await buildDatabaseDump();

  const url = new URL(process.env.DATABASE_URL!);
  const restoreName = `${url.pathname.slice(1)}_restore_test`;
  const restoreUrl = new URL(url);
  restoreUrl.pathname = `/${restoreName}`;
  const connection = ['-h', url.searchParams.get('host') || url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username) || 'postgres'];
  const env = { ...process.env, LC_ALL: 'C', DATABASE_URL: restoreUrl.toString() };
  const run = (command: string, args: string[]) => {
    const done = spawnSync(command, args, { env, encoding: 'utf8' });
    assert.equal(done.status, 0, `${command} ${args.join(' ')}\n${done.stdout}\n${done.stderr}`);
    return done.stdout;
  };

  // 1. An empty database, 2. its tables from this code, 3. the backup, 4. the deploy SQL (triggers).
  run(PSQL, [...connection, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE IF EXISTS "${restoreName}"`]);
  run(PSQL, [...connection, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE "${restoreName}"`]);
  run(join(process.cwd(), 'node_modules/.bin/prisma'), ['db', 'push', '--skip-generate']);
  const dir = mkdtempSync(join(tmpdir(), 'erp-backup-'));
  const file = join(dir, 'backup.sql');
  writeFileSync(file, dump);
  run(PSQL, [...connection, '-d', restoreName, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file]);
  rmSync(dir, { recursive: true, force: true });

  const restored = new PrismaClient({ datasourceUrl: restoreUrl.toString() });
  try {
    const [source, copy] = [await fingerprint(prisma), await fingerprint(restored)];
    assert.deepEqual(copy, source);
    assert.ok(source.Order.rows === 1 && source.Transaction.rows > 0 && source.SiteHookLog.rows > 0 && source.AIAction.rows === 1);
    assert.deepEqual(await money(restored), await money(prisma));

    run(PSQL, [...connection, '-d', restoreName, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(process.cwd(), 'prisma/sql/pre-push-unique-columns.sql')]);

    // The counters carry on: the next order number and log id follow the restored rows.
    const lastOrder = await restored.order.findFirstOrThrow();
    const next = await restored.order.create({ data: { customerId: lastOrder.customerId, totalAmount: 0, paidAmount: 0 } });
    assert.equal(next.number, lastOrder.number + 1);
    // The deploy SQL put the stock-push triggers back: a stock change is logged again.
    const logged = await restored.siteHookLog.count();
    await restored.inventory.updateMany({ data: { quantity: { increment: 1 } } });
    assert.ok((await restored.siteHookLog.count()) > logged);
  } finally {
    await restored.$disconnect();
    spawnSync(PSQL, [...connection, '-d', 'postgres', '-c', `DROP DATABASE IF EXISTS "${restoreName}"`], { env });
  }
});

test('the dump says how to restore it, including the deploy SQL after the rows', async () => {
  const sql = await buildDatabaseDump(new Date('2026-09-24T00:00:00Z'));
  assert.match(sql, /npx prisma db push/);
  assert.match(sql, /psql "<database url>" -v ON_ERROR_STOP=1 -f <this file>/);
  assert.match(sql, /and last `npx prisma db execute --file prisma\/sql\/pre-push-unique-columns\.sql`/);
});

test("the dump names the commit it was taken with: Vercel's, else APP_COMMIT_SHA (Liara), else none", async () => {
  const saved = { vercel: process.env.VERCEL_GIT_COMMIT_SHA, app: process.env.APP_COMMIT_SHA };
  const header = async () => (await buildDatabaseDump(new Date('2026-09-24T00:00:00Z'))).split('\n')[1];
  try {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.APP_COMMIT_SHA;
    assert.equal(await header(), '-- Taken: 2026-09-24T00:00:00.000Z');
    process.env.APP_COMMIT_SHA = 'e7ffa7a0000000000000000000000000000liara';
    assert.equal(await header(), '-- Taken: 2026-09-24T00:00:00.000Z   Code: e7ffa7a0000000000000000000000000000liara');
    process.env.VERCEL_GIT_COMMIT_SHA = '1022c870000000000000000000000000000vercel';
    assert.equal(await header(), '-- Taken: 2026-09-24T00:00:00.000Z   Code: 1022c870000000000000000000000000000vercel');
  } finally {
    for (const [key, value] of [['VERCEL_GIT_COMMIT_SHA', saved.vercel], ['APP_COMMIT_SHA', saved.app]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

// ---------------------------------------------------------------- storing and pruning

test('a backup goes to /backups on the FTP server, is remembered as the last one, and the newest `keep` stay', async () => {
  await withFtp();
  for (const stamp of ['2026-09-20T00-00-00', '2026-09-21T00-00-00', '2026-09-22T00-00-00', '2026-09-23T00-00-00']) oldBackup(stamp);
  fakeFtp.files.set(`${BACKUP_FOLDER}/notes.txt`, Buffer.from('keep me'));
  fakeFtp.files.set(`${BACKUP_FOLDER}/backup-by-hand.sql`, Buffer.from('keep me too'));
  fakeFtp.files.set('/uploads/receipts/00000000-0000-4000-8000-000000000000.png', Buffer.from('a receipt'));

  const info = await runBackup(3, new Date('2026-09-24T12:02:11.500Z'));
  assert.deepEqual(info, {
    filename: 'backup-2026-09-24T12-02-11.sql',
    downloadUrl: '/api/backups/backup-2026-09-24T12-02-11.sql',
    size: fakeFtp.files.get('/backups/backup-2026-09-24T12-02-11.sql')!.length,
    sizeInMB: (info.size / (1024 * 1024)).toFixed(2),
    createdAt: '2026-09-24T12:02:11.500Z',
  });
  assert.match(fakeFtp.files.get('/backups/backup-2026-09-24T12-02-11.sql')!.toString('utf8'), /^-- TheMoak ERP/);
  assert.deepEqual(await readSystemSetting('last_backup'), info);
  assert.deepEqual(backupFiles(), [
    '/backups/backup-2026-09-22T00-00-00.sql',
    '/backups/backup-2026-09-23T00-00-00.sql',
    '/backups/backup-2026-09-24T12-02-11.sql',
    '/backups/backup-by-hand.sql',
    '/backups/notes.txt',
  ]);
  assert.ok(fakeFtp.files.has('/uploads/receipts/00000000-0000-4000-8000-000000000000.png'));
  assert.equal(fakeFtp.logins[0].host, 'ftp.example.test');
});

test('pruning never deletes the backup just taken, whatever count is stored', async () => {
  await withFtp();
  const cases: Array<[unknown, number]> = [[1, 1], [0, 1], [-5, 1], [2.7, 2], ['2', 2], ['abc', 3], [undefined, 3], [null, 1]];
  for (const [keep, left] of cases) {
    fakeFtp.files.clear();
    oldBackup('2026-09-20T00-00-00');
    oldBackup('2026-09-21T00-00-00');
    await runBackup(keep as number, new Date('2026-09-24T00:00:00Z'));
    assert.equal(backupFiles().length, left, `keep ${String(keep)}`);
    assert.ok(fakeFtp.files.has('/backups/backup-2026-09-24T00-00-00.sql'), `keep ${String(keep)}`);
  }
});

test('an unreachable FTP server fails the backup in words, and the last backup stays as it was', async () => {
  await withFtp();
  await prisma.systemSetting.create({ data: { key: 'last_backup', value: JSON.stringify({ filename: 'backup-old.sql' }) } });
  fakeFtp.failWith = Object.assign(new Error('connect ECONNREFUSED 31.214.255.152:21'), { code: 'ECONNREFUSED' });
  const result: any = await createBackup();
  assert.equal(result.success, false);
  assert.match(result.error, /^بک‌آپ گرفته نشد: /);
  assert.deepEqual(await readSystemSetting('last_backup'), { filename: 'backup-old.sql' });
  assert.equal(fakeFtp.files.size, 0);
});

test('without FTP settings the backup refuses in Persian', async () => {
  const result: any = await createBackup();
  assert.deepEqual(result, { success: false, error: 'بک‌آپ گرفته نشد: اطلاعات سرور FTP در تنظیمات وارد نشده است.' });
});

test('an admin backs up by hand with the stored count, and lists the backups newest first', async () => {
  await withFtp();
  await prisma.systemSetting.create({ data: { key: 'backup_settings', value: JSON.stringify({ enabled: true, frequency: 'daily', keepBackups: 2 }) } });
  oldBackup('2026-09-20T00-00-00');
  oldBackup('2026-09-21T00-00-00');
  fakeFtp.files.set('/backups/readme.txt', Buffer.from('x'));
  const made: any = await createBackup();
  assert.equal(made.success, true, made.error);
  assert.equal(backupFiles().filter((f) => /backup-\d/.test(f)).length, 2);

  const listed: any = await listBackups();
  assert.equal(listed.success, true);
  assert.deepEqual(listed.backups.map((b: { filename: string }) => b.filename), [made.filename, 'backup-2026-09-21T00-00-00.sql']);
  assert.equal(listed.backups[1].createdAt, '2026-09-21T00:00:00Z');
  assert.equal(listed.backups[1].downloadUrl, '/api/backups/backup-2026-09-21T00-00-00.sql');
  assert.equal(listed.backups[1].size, '-- 2026-09-21T00-00-00'.length);
  assert.deepEqual(await getLastBackup(), made && { filename: made.filename, downloadUrl: made.downloadUrl, size: made.size, sizeInMB: made.sizeInMB, createdAt: made.createdAt });
});

test('a backup downloads for an admin with its bytes; a missing one is 404 and a dead FTP server 502', async () => {
  await withFtp();
  oldBackup('2026-09-21T00-00-00');
  const get = (name: string) => download(new NextRequest(`http://localhost/api/backups/${name}`), { params: Promise.resolve({ filename: name }) });

  const ok = await get('backup-2026-09-21T00-00-00.sql');
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '-- 2026-09-21T00-00-00');
  assert.equal(ok.headers.get('content-disposition'), 'attachment; filename="backup-2026-09-21T00-00-00.sql"');
  assert.equal(ok.headers.get('cache-control'), 'no-store');

  assert.equal((await get('backup-2026-09-19T00-00-00.sql')).status, 404);
  fakeFtp.failWith = new Error('connect ETIMEDOUT');
  const dead = await get('backup-2026-09-21T00-00-00.sql');
  assert.equal(dead.status, 502);
  assert.equal((await dead.json()).error, 'دسترسی به سرور FTP ممکن نشد');
});

// ---------------------------------------------------------------- the schedule

test('the backup schedule is saved only with values the Jalali calendar and the form allow', async () => {
  const good = { enabled: true, frequency: 'monthly' as const, dayOfMonth: 29, keepBackups: 365 };
  assert.deepEqual(await saveBackupSettings(good), { success: true });
  assert.deepEqual(await getBackupSettings(), good);

  const bad: Array<[Record<string, unknown>, string]> = [
    [{ frequency: 'monthly', dayOfMonth: 30 }, 'روز ماه باید بین ۱ تا ۲۹ باشد.'],
    [{ frequency: 'monthly', dayOfMonth: 31 }, 'روز ماه باید بین ۱ تا ۲۹ باشد.'],
    [{ frequency: 'monthly', dayOfMonth: 0 }, 'روز ماه باید بین ۱ تا ۲۹ باشد.'],
    [{ frequency: 'monthly', dayOfMonth: 1.5 }, 'روز ماه باید بین ۱ تا ۲۹ باشد.'],
    [{ frequency: 'weekly', dayOfWeek: 7 }, 'روز هفته نامعتبر است.'],
    [{ frequency: 'weekly', dayOfWeek: -1 }, 'روز هفته نامعتبر است.'],
    [{ frequency: 'hourly' }, 'تناوب بک‌آپ نامعتبر است.'],
    [{ frequency: 'daily', keepBackups: 0 }, 'تعداد بک‌آپ‌های نگه‌داری‌شده باید بین ۱ تا ۳۶۵ باشد.'],
    [{ frequency: 'daily', keepBackups: 'abc' }, 'تعداد بک‌آپ‌های نگه‌داری‌شده باید بین ۱ تا ۳۶۵ باشد.'],
    [{ frequency: 'daily', keepBackups: 1000 }, 'تعداد بک‌آپ‌های نگه‌داری‌شده باید بین ۱ تا ۳۶۵ باشد.'],
  ];
  for (const [settings, error] of bad) {
    assert.deepEqual(await saveBackupSettings({ enabled: true, ...settings } as any), { success: false, error }, JSON.stringify(settings));
  }
  assert.deepEqual(await getBackupSettings(), good);

  for (const role of ['ACCOUNTANT', 'AUDITOR', 'SALES', 'WAREHOUSE', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    assert.equal((await saveBackupSettings({ enabled: false, frequency: 'daily' })).success, false, String(role));
  }
  setTestRole('ADMIN');
  assert.deepEqual(await getBackupSettings(), good);
});

test('the daily check follows Tehran midnight (20:30 UTC) in every season', () => {
  const daily = { enabled: true, frequency: 'daily' as const };
  // Thursday 23:59 and Friday 00:01 in Tehran are the same UTC date, but two Tehran days.
  assert.equal(isBackupDue(daily, { createdAt: '2026-09-24T20:29:00Z' }, new Date('2026-09-24T20:31:00Z')), true);
  // Friday 00:30 and Friday 22:30 in Tehran are two UTC dates, but one Tehran day.
  assert.equal(isBackupDue(daily, { createdAt: '2026-09-24T21:00:00Z' }, new Date('2026-09-25T19:00:00Z')), false);
  // Summer too: Iran keeps +03:30 all year.
  assert.equal(isBackupDue(daily, { createdAt: '2026-06-21T20:29:59Z' }, new Date('2026-06-21T20:30:00Z')), true);
  assert.equal(isBackupDue(daily, { createdAt: '2026-06-21T20:30:00Z' }, new Date('2026-06-22T20:29:59Z')), false);
  // The cron runs at 00:00 UTC, 03:30 in Tehran: a backup taken by hand the evening before does not skip it.
  assert.equal(isBackupDue(daily, { createdAt: '2026-09-24T19:00:00Z' }, new Date('2026-09-25T00:00:00Z')), true);
  assert.equal(isBackupDue(daily, { createdAt: 'not a date' }, new Date('2026-09-25T00:00:00Z')), true);
});

test('a weekly backup falls on its Tehran weekday, switching at 20:30 UTC', () => {
  const friday = { enabled: true, frequency: 'weekly' as const, dayOfWeek: 5 };
  assert.equal(isBackupDue(friday, undefined, new Date('2026-09-24T20:29:59Z')), false); // Thursday 23:59:59
  assert.equal(isBackupDue(friday, undefined, new Date('2026-09-24T20:30:00Z')), true); // Friday 00:00
  assert.equal(isBackupDue(friday, undefined, new Date('2026-09-25T20:29:59Z')), true); // Friday 23:59:59
  assert.equal(isBackupDue(friday, undefined, new Date('2026-09-25T20:30:00Z')), false); // Saturday
  // Saturday (6) and Sunday (0, the default).
  assert.equal(isBackupDue({ enabled: true, frequency: 'weekly', dayOfWeek: 6 }, undefined, new Date('2026-09-26T00:00:00Z')), true);
  assert.equal(isBackupDue({ enabled: true, frequency: 'weekly' }, undefined, new Date('2026-09-27T00:00:00Z')), true);
});

test('a monthly backup falls on its Jalali day, at Tehran midnight, across the year end', () => {
  const on = (dayOfMonth: number, at: string) => isBackupDue({ enabled: true, frequency: 'monthly', dayOfMonth }, undefined, new Date(at));
  // 31 Shahrivar 1405 ends at 2026-09-22T20:30Z, when 1 Mehr begins.
  assert.equal(on(1, '2026-09-22T20:29:59Z'), false);
  assert.equal(on(1, '2026-09-22T20:30:00Z'), true);
  // 29 Esfand 1405 is the last day of that year; 1 Farvardin 1406 begins 2027-03-20T20:30Z.
  assert.equal(on(29, '2027-03-20T20:29:59Z'), true);
  assert.equal(on(1, '2027-03-20T20:30:00Z'), true);
  assert.equal(on(29, '2027-03-20T20:30:00Z'), false);
  // 30 Bahman 1405: a 30-day month.
  assert.equal(on(29, '2027-02-18T20:30:00Z'), false);
  // The default day is the 1st.
  assert.equal(isBackupDue({ enabled: true, frequency: 'monthly' }, undefined, new Date('2026-09-23T00:00:00Z')), true);
});

test('the scheduled backup refuses without CRON_SECRET, runs once on its day, and reports a failure', async () => {
  const saved = process.env.CRON_SECRET;
  const call = (authorization?: string) =>
    scheduled(new NextRequest('http://localhost/api/cron/backup', { headers: authorization ? { authorization } : {} }));
  try {
    delete process.env.CRON_SECRET;
    for (const header of [undefined, 'Bearer ', 'Bearer undefined', 'Bearer null']) assert.equal((await call(header)).status, 401, String(header));
    process.env.CRON_SECRET = '';
    assert.equal((await call('Bearer ')).status, 401);

    process.env.CRON_SECRET = 'cron-secret-for-tests';
    for (const header of [undefined, 'Bearer nope', 'cron-secret-for-tests', 'Bearer cron-secret-for-testsX', 'bearer cron-secret-for-tests']) {
      assert.equal((await call(header)).status, 401, String(header));
    }
    assert.equal(fakeFtp.files.size, 0);

    await withFtp();
    await prisma.systemSetting.create({ data: { key: 'backup_settings', value: JSON.stringify({ enabled: true, frequency: 'daily', keepBackups: 5 }) } });
    fakeFtp.failWith = new Error('530 Login incorrect.');
    const failed = await call('Bearer cron-secret-for-tests');
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { ok: false, message: '530 Login incorrect.' });
    assert.equal(await readSystemSetting('last_backup'), undefined);

    fakeFtp.failWith = null;
    const ran = await call('Bearer cron-secret-for-tests');
    assert.equal(ran.status, 200);
    const body = await ran.json();
    assert.equal(body.ok, true);
    assert.match(body.backup, /^backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.sql$/);
    assert.deepEqual(backupFiles(), [`/backups/${body.backup}`]);

    // A retry, or a second deployment's cron, the same Tehran day: skipped.
    assert.deepEqual(await (await call('Bearer cron-secret-for-tests')).json(), { ok: true, skipped: true });
    assert.equal(backupFiles().length, 1);
  } finally {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  }
});

test('two instances checking at the same moment take one backup between them, and a failed one leaves the day open', async () => {
  const saved = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'cron-secret-for-tests';
  const call = () =>
    scheduled(new NextRequest('http://localhost/api/cron/backup', { headers: { authorization: 'Bearer cron-secret-for-tests' } }));
  const ftp = Client.prototype as any;
  const upload = ftp.uploadFrom;
  try {
    await withFtp();
    await prisma.systemSetting.create({ data: { key: 'backup_settings', value: JSON.stringify({ enabled: true, frequency: 'daily', keepBackups: 5 }) } });

    // The first instance stops mid-upload: it has read last_backup (none today) and not yet written it.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let uploading!: () => void;
    const inUpload = new Promise<void>((resolve) => (uploading = resolve));
    ftp.uploadFrom = async function (...args: unknown[]) {
      uploading();
      await gate;
      return upload.apply(this, args);
    };
    const first = call();
    await inUpload;
    assert.equal(await readSystemSetting('last_backup'), undefined, 'the first has not recorded its backup yet');

    // The second instance finds the check taken and skips, without waiting for the first.
    const second = await call();
    assert.deepEqual(await second.json(), { ok: true, skipped: true });

    release();
    const done = await (await first).json();
    assert.equal(done.ok, true);
    assert.deepEqual(backupFiles(), [`/backups/${done.backup}`]);
    ftp.uploadFrom = upload;

    // Once it is done, a third check the same Tehran day finds today's backup.
    assert.deepEqual(await (await call()).json(), { ok: true, skipped: true });
    assert.equal(backupFiles().length, 1);

    // A check whose backup fails releases the lock: the next check that day takes it.
    await prisma.systemSetting.delete({ where: { key: 'last_backup' } });
    fakeFtp.failWith = new Error('421 Too many connections.');
    assert.equal((await call()).status, 500);
    fakeFtp.failWith = null;
    const retried = await (await call()).json();
    assert.equal(retried.ok, true);
    assert.ok(retried.backup);
  } finally {
    ftp.uploadFrom = upload;
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  }
});
