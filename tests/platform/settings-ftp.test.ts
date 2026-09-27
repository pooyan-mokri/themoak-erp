import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { fakeFtp, FTP_SETTINGS } from './fake-ftp';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { ROLES } from '@/lib/permissions';
import { ACCESS_DENIED_MESSAGE } from '@/lib/access';
import { getFTPCredentials, saveFTPCredentials, testFTPConnectionAction } from '@/actions/ftp';
import { getCompanyInfo, getSetting, saveCompanyInfo, saveSetting } from '@/actions/settings';
import { readSystemSetting } from '@/lib/system-settings';
import { isReceiptRef } from '@/lib/receipt-ref';
import { storeReceipt } from '@/lib/receipt-storage';

console.error = () => {};

const NON_ADMINS = [null, ...ROLES.filter((role) => role !== 'ADMIN')];
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('photo')]);

beforeEach(async () => {
  setTestRole('ADMIN');
  fakeFtp.reset();
  await resetDatabase();
});
after(() => prisma.$disconnect());

const form = { ...FTP_SETTINGS, basePath: '/uploads/receipts', ignoreCertificateErrors: false };

test('an admin saves the FTP settings; a trailing slash on the folder is dropped', async () => {
  assert.deepEqual(await saveFTPCredentials({ ...form, basePath: '/moak/receipts/' }), { success: true });
  assert.deepEqual(await readSystemSetting('ftp_credentials'), { ...form, basePath: '/moak/receipts' });
  assert.deepEqual(await getFTPCredentials(), { ...form, basePath: '/moak/receipts' });

  // An empty folder means the default one.
  assert.deepEqual(await saveFTPCredentials({ ...form, basePath: '' }), { success: true });
  assert.equal((await readSystemSetting('ftp_credentials')).basePath, undefined);
});

test('FTP settings a receipt could never be stored under are refused in Persian and nothing is saved', async () => {
  await saveFTPCredentials(form);
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ host: '' }, /آدرس سرور/],
    [{ host: '   ' }, /آدرس سرور/],
    [{ user: '' }, /نام کاربری/],
    [{ port: 0 }, /پورت/],
    [{ port: 70000 }, /پورت/],
    [{ port: 21.5 }, /پورت/],
    [{ port: '21' }, /پورت/],
    [{ basePath: 'uploads/receipts' }, /مسیر پوشه/],
    [{ basePath: '/uploads/../etc' }, /مسیر پوشه/],
    [{ basePath: '/uploads//receipts' }, /مسیر پوشه/],
    [{ basePath: '/رسیدها' }, /مسیر پوشه/],
    [{ basePath: '/up loads' }, /مسیر پوشه/],
    [{ basePath: '/.hidden' }, /مسیر پوشه/],
  ];
  for (const [change, message] of cases) {
    const result = await saveFTPCredentials({ ...form, ...change } as any);
    assert.equal(result.success, false, JSON.stringify(change));
    assert.match(result.error ?? '', message, JSON.stringify(change));
  }
  assert.deepEqual(await readSystemSetting('ftp_credentials'), form);
});

test('only an admin saves, reads or tests the FTP settings, refused in Persian', async () => {
  await saveFTPCredentials(form);
  for (const role of NON_ADMINS) {
    setTestRole(role);
    assert.deepEqual(await saveFTPCredentials({ ...form, host: 'attacker.example' }), { success: false, error: ACCESS_DENIED_MESSAGE }, String(role));
    assert.deepEqual(await testFTPConnectionAction(), { success: false, error: ACCESS_DENIED_MESSAGE }, String(role));
    assert.equal(await getFTPCredentials(), null, String(role));
  }
  assert.equal(fakeFtp.logins.length, 0);
  assert.deepEqual(await readSystemSetting('ftp_credentials'), form);
});

test('testing the connection logs in with the saved settings and explains a refusal in Persian', async () => {
  assert.deepEqual(await testFTPConnectionAction(), { success: false, error: 'اطلاعات سرور FTP در تنظیمات وارد نشده است.' });

  await saveFTPCredentials({ ...form, secure: true, ignoreCertificateErrors: true });
  assert.deepEqual(await testFTPConnectionAction(), { success: true });
  assert.deepEqual(fakeFtp.logins[0], {
    host: 'ftp.example.test',
    port: 21,
    user: 'moak',
    password: 'ftp-secret',
    secure: true,
    secureOptions: { rejectUnauthorized: false },
  });

  const failures: Array<[Error, RegExp]> = [
    [Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:21'), { code: 'ECONNREFUSED' }), /اتصال رد شد/],
    [Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }), /زمان‌بر شد/],
    [Object.assign(new Error('getaddrinfo ENOTFOUND ftp.example.test'), { code: 'ENOTFOUND' }), /آدرس سرور پیدا نشد/],
    [new Error("Hostname/IP does not match certificate's altnames"), /گواهینامه/],
  ];
  for (const [error, message] of failures) {
    fakeFtp.failWith = error;
    const result = await testFTPConnectionAction();
    assert.equal(result.success, false);
    assert.match(result.error ?? '', message);
  }
});

test('receipts go to the saved folder, a trailing slash included, as references the viewer accepts', async () => {
  await prisma.systemSetting.create({ data: { key: 'ftp_credentials', value: JSON.stringify({ ...FTP_SETTINGS, basePath: '/moak/receipts/' }) } });
  const ref = await storeReceipt(PNG, 'image/png');
  assert.match(ref, /^ftp:\/moak\/receipts\/[0-9a-f-]{36}\.png$/);
  assert.ok(isReceiptRef(ref));
  assert.deepEqual(fakeFtp.files.get(ref.slice('ftp:'.length)), PNG);
});

test('the generic settings actions refuse in Persian, and company info stays with every signed-in user', async () => {
  const site = await saveSetting('site_connection', { origin: 'https://evil.example' });
  assert.deepEqual(site, { success: false, error: 'این تنظیم فقط از صفحهٔ خودش تغییر می‌کند.' });

  assert.deepEqual(await saveCompanyInfo({ name: 'دِ موک', phone: '021', address: 'تهران' }), { success: true });
  for (const role of NON_ADMINS) {
    setTestRole(role);
    const saved = await saveCompanyInfo({ name: 'Hacked', phone: '', address: '' });
    assert.equal(saved.success, false, String(role));
    assert.doesNotMatch(saved.error ?? '', /[A-Za-z]/, String(role));
    assert.equal((await saveSetting('backup_settings', { enabled: false })).success, false);
  }
  for (const role of ROLES) {
    setTestRole(role);
    assert.deepEqual(await getCompanyInfo(), { name: 'دِ موک', phone: '021', address: 'تهران' }, role);
  }
  setTestRole('ADMIN');
  assert.equal(await getSetting('no_such_key'), undefined);
});
