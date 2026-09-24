import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { buildDatabaseDump, isBackupDue, isBackupName } from '@/lib/db-backup';
import { createBackup, listBackups } from '@/actions/backup';
import { GET as download } from '@/app/api/backups/[filename]/route';
import { GET as scheduled } from '@/app/api/cron/backup/route';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

test('the backup holds every table with rows, and resets the order counter', async () => {
  await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 1000 } });
  await prisma.customer.create({ data: { name: "O'Brien — نام با ' و \\\\" } });
  const sql = await buildDatabaseDump(new Date('2026-09-24T00:00:00Z'));
  assert.match(sql, /^-- TheMoak ERP/);
  assert.match(sql, /SET session_replication_role = replica;\nBEGIN;/);
  assert.match(sql, /INSERT INTO "Account" SELECT \* FROM json_populate_recordset\(NULL::"Account"/);
  assert.match(sql, /INSERT INTO "Customer"/);
  assert.match(sql, /-- Order: 0 rows/);
  assert.match(sql, /setval\('public\."Order_number_seq"'/);
  assert.match(sql, /COMMIT;\nSET session_replication_role = DEFAULT;/);
});

test('a scheduled backup runs on its day in Tehran, once', () => {
  // 2026-09-24 21:00 UTC is Friday 00:30 in Tehran; 2026-09-24 12:00 UTC is Thursday.
  const thursday = new Date('2026-09-24T12:00:00Z');
  const fridayInTehran = new Date('2026-09-24T21:00:00Z');
  assert.equal(isBackupDue(undefined, undefined, thursday), false);
  assert.equal(isBackupDue({ enabled: false, frequency: 'daily' }, undefined, thursday), false);
  assert.equal(isBackupDue({ enabled: true, frequency: 'daily' }, undefined, thursday), true);
  assert.equal(isBackupDue({ enabled: true, frequency: 'weekly', dayOfWeek: 4 }, undefined, thursday), true);
  assert.equal(isBackupDue({ enabled: true, frequency: 'weekly', dayOfWeek: 4 }, undefined, fridayInTehran), false);
  assert.equal(isBackupDue({ enabled: true, frequency: 'weekly', dayOfWeek: 5 }, undefined, fridayInTehran), true);
  // 2026-09-24 is 2 Mehr 1405.
  assert.equal(isBackupDue({ enabled: true, frequency: 'monthly', dayOfMonth: 2 }, undefined, thursday), true);
  assert.equal(isBackupDue({ enabled: true, frequency: 'monthly', dayOfMonth: 3 }, undefined, thursday), false);
  // Already taken today (Tehran): a second deployment or a retry skips.
  const takenThisMorning = { createdAt: '2026-09-24T04:00:00Z' };
  assert.equal(isBackupDue({ enabled: true, frequency: 'daily' }, takenThisMorning, thursday), false);
  assert.equal(isBackupDue({ enabled: true, frequency: 'daily' }, { createdAt: '2026-09-23T12:00:00Z' }, thursday), true);
});

test('only an admin backs up, lists or downloads; only backup names are served', async () => {
  for (const role of ['ACCOUNTANT', 'AUDITOR', 'SALES', null]) {
    setTestRole(role);
    assert.equal((await createBackup()).success, false, String(role));
    assert.equal((await listBackups()).success, false, String(role));
    const res = await download(new NextRequest('http://localhost/api/backups/backup-2026-09-24T00-00-00.sql'), {
      params: Promise.resolve({ filename: 'backup-2026-09-24T00-00-00.sql' }),
    });
    assert.equal(res.status, 401, String(role));
  }
  setTestRole('ADMIN');
  for (const name of ['../.env', 'backup.sql', 'receipt.png', 'backup-2026-09-24T00-00-00.sql.php']) {
    assert.equal(isBackupName(name), false, name);
    const res = await download(new NextRequest(`http://localhost/api/backups/${encodeURIComponent(name)}`), {
      params: Promise.resolve({ filename: name }),
    });
    assert.equal(res.status, 400, name);
  }
});

test('the scheduled backup refuses a call without the cron secret', async () => {
  const saved = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'cron-secret-for-tests';
  try {
    assert.equal((await scheduled(new NextRequest('http://localhost/api/cron/backup'))).status, 401);
    const wrong = new NextRequest('http://localhost/api/cron/backup', { headers: { authorization: 'Bearer nope' } });
    assert.equal((await scheduled(wrong)).status, 401);
    // With the secret and no schedule switched on, nothing is taken.
    const right = new NextRequest('http://localhost/api/cron/backup', { headers: { authorization: 'Bearer cron-secret-for-tests' } });
    const res = await scheduled(right);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, skipped: true });
  } finally {
    process.env.CRON_SECRET = saved;
  }
});
