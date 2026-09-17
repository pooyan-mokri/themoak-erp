import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getAISettings, updateAISettings } from '@/actions/ai-assistant';
import { readAISettingsWithKey } from '@/lib/ai-settings';
import { getSetting, saveSetting, getCompanyInfo } from '@/actions/settings';
import { readSystemSetting } from '@/lib/system-settings';
import { getFTPCredentials } from '@/actions/ftp';
import { getBackupSettings, getLastBackup } from '@/actions/backup';
import { getRecentActivities } from '@/actions/activity';
import { getRecentActivity } from '@/actions/dashboard';
import { getCRMDashboardStats } from '@/actions/crm';
import { logActivity } from '@/lib/activity-log';

const ROOT = process.cwd();
const NON_ADMINS = [null, 'USER', 'SALES', 'WAREHOUSE', 'ACCOUNTANT', 'PROJECT_MANAGER'];
const SIGNED_IN_NON_ADMINS = NON_ADMINS.filter((role) => role !== null);

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const aiRow = (apiKey: string) =>
  prisma.aISettings.create({ data: { provider: 'OPENAI', apiKey, model: 'gpt-4', enabled: true, maxTokens: 1500, temperature: 0.7 } });

test('getAISettings never serves the API key, to any role or to a stranger, and says whether one is set', async () => {
  for (const role of [...NON_ADMINS, 'ADMIN']) {
    setTestRole(role);
    const settings = await getAISettings();
    assert.equal('apiKey' in settings, false, `role ${role}`);
    assert.equal(settings.hasApiKey, false, `role ${role}`);
  }

  await prisma.aISettings.updateMany({ data: { apiKey: 'sk-secret-key' } });
  for (const role of [...NON_ADMINS, 'ADMIN']) {
    setTestRole(role);
    const settings = await getAISettings();
    assert.equal('apiKey' in settings, false, `role ${role}`);
    assert.equal(settings.hasApiKey, true, `role ${role}`);
    assert.equal(JSON.stringify(settings).includes('sk-secret-key'), false, `role ${role}`);
  }
});

test('only an admin can change the AI settings, and an empty key keeps the stored one', async () => {
  await aiRow('sk-old');
  const change = { provider: 'ANTHROPIC' as const, apiKey: 'sk-attacker', model: 'claude', enabled: false };

  for (const role of NON_ADMINS) {
    setTestRole(role);
    assert.equal((await updateAISettings(change)).success, false, `role ${role} must be refused`);
  }
  let row = await prisma.aISettings.findFirstOrThrow();
  assert.equal(row.apiKey, 'sk-old');
  assert.equal(row.model, 'gpt-4');

  setTestRole('ADMIN');
  assert.equal((await updateAISettings({ ...change, apiKey: '' })).success, true);
  row = await prisma.aISettings.findFirstOrThrow();
  assert.equal(row.apiKey, 'sk-old', 'an empty key keeps the stored key');
  assert.equal(row.model, 'claude');

  assert.equal((await updateAISettings({ ...change, apiKey: 'sk-new' })).success, true);
  assert.equal((await prisma.aISettings.findFirstOrThrow()).apiKey, 'sk-new');

  // The server-only reader the chat uses still gets the key, with no session.
  setTestRole(null);
  assert.equal((await readAISettingsWithKey())?.apiKey, 'sk-new');
});

const FTP = { host: 'ftp.example.com', port: 21, user: 'moak', password: 'ftp-secret-password', secure: false };
const COMPANY = { name: 'The Moak', phone: '021', address: 'Tehran', logo: 'data:image/png;base64,AAAA' };
const PRIVATE_KEYS = ['ftp_credentials', 'backup_settings', 'last_backup', 'woo_settings'];

async function seedSettings() {
  await prisma.systemSetting.createMany({
    data: [
      { key: 'ftp_credentials', value: JSON.stringify(FTP) },
      { key: 'company_info', value: JSON.stringify(COMPANY) },
      { key: 'backup_settings', value: JSON.stringify({ enabled: true, frequency: 'daily' }) },
      { key: 'last_backup', value: JSON.stringify({ filename: 'backup-x.sql' }) },
      { key: 'woo_settings', value: JSON.stringify({ warehouseId: 'w1' }) },
    ],
  });
}

test('getSetting serves the FTP credentials and every other private key to an admin only', async () => {
  await seedSettings();

  for (const role of NON_ADMINS) {
    setTestRole(role);
    for (const key of PRIVATE_KEYS) {
      assert.equal(await getSetting(key), undefined, `role ${role}, key ${key}`);
    }
    assert.equal(await getFTPCredentials(), null, `role ${role}`);
    assert.equal(await getBackupSettings(), undefined, `role ${role}`);
    assert.equal(await getLastBackup(), undefined, `role ${role}`);
  }

  setTestRole('ADMIN');
  assert.deepEqual(await getSetting('ftp_credentials'), FTP);
  assert.deepEqual(await getSetting('woo_settings'), { warehouseId: 'w1' });
  assert.deepEqual(await getFTPCredentials(), FTP);
  assert.deepEqual(await getBackupSettings(), { enabled: true, frequency: 'daily' });
  assert.deepEqual(await getLastBackup(), { filename: 'backup-x.sql' });

  // Server code (FTP upload) still reads the credentials, with no session.
  setTestRole(null);
  assert.deepEqual(await readSystemSetting('ftp_credentials'), FTP);
});

test('company_info (the logo and invoice header) stays readable for every signed-in user, not for a stranger', async () => {
  await seedSettings();
  for (const role of [...SIGNED_IN_NON_ADMINS, 'ADMIN']) {
    setTestRole(role);
    assert.deepEqual(await getSetting('company_info'), COMPANY, `role ${role}`);
    assert.deepEqual(await getCompanyInfo(), COMPANY, `role ${role}`);
  }
  setTestRole(null);
  assert.equal(await getSetting('company_info'), undefined);
});

test('saveSetting is refused for a non-admin, and still works for an admin', async () => {
  await seedSettings();
  for (const role of NON_ADMINS) {
    setTestRole(role);
    const ftp = await saveSetting('ftp_credentials', { ...FTP, host: 'attacker.example' });
    assert.equal(ftp.success, false, `role ${role}`);
    assert.equal((await saveSetting('company_info', { name: 'Hacked' })).success, false, `role ${role}`);
  }
  assert.deepEqual(await readSystemSetting('ftp_credentials'), FTP);
  assert.deepEqual(await readSystemSetting('company_info'), COMPANY);

  setTestRole('ADMIN');
  assert.equal((await saveSetting('backup_settings', { enabled: false })).success, true);
  assert.deepEqual(await readSystemSetting('backup_settings'), { enabled: false });
});

test('the activity log is served to an admin only, and never with a password hash', async () => {
  const user = await prisma.user.create({
    data: { name: 'Staff', email: 'staff@example.com', password: '$2a$10$hash-that-must-stay-home', role: 'USER' },
  });
  await logActivity(user.id, 'UPDATE_PROFILE', 'پروفایل کاربری بروزرسانی شد.');

  for (const role of NON_ADMINS) {
    setTestRole(role);
    assert.deepEqual(await getRecentActivities(), [], `role ${role}`);
    assert.deepEqual(await getRecentActivity(), [], `role ${role}`);
    assert.deepEqual((await getCRMDashboardStats()).recentActivity, [], `role ${role}`);
  }

  setTestRole('ADMIN');
  const activities = await getRecentActivities();
  assert.equal(activities.length, 1);
  assert.deepEqual(activities[0].user, { id: user.id, name: 'Staff', email: 'staff@example.com', role: 'USER' });
  assert.equal(await getRecentActivity().then((rows) => rows.length), 1);
  const crm = (await getCRMDashboardStats()).recentActivity as any[];
  assert.equal(crm.length, 1);
  for (const served of [activities, await getRecentActivity(), crm]) {
    assert.equal(JSON.stringify(served).includes('hash-that-must-stay-home'), false);
    assert.equal(JSON.stringify(served).includes('"password"'), false);
  }
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

test('logActivity is not exported from any server action file', async () => {
  const useServer = sourceFiles(join(ROOT, 'src/actions')).filter((path) =>
    /^(\s*(\/\/[^\n]*|\/\*[\s\S]*?\*\/))*\s*(['"])use server\3/.test(readFileSync(path, 'utf8')),
  );
  assert.ok(useServer.length > 0);
  for (const path of useServer) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /export[^\n]*\blogActivity\b/, path);
  }
  assert.equal('logActivity' in (await import('@/actions/activity')), false);
});

test('the unauthenticated setup-admin route is gone', () => {
  assert.equal(existsSync(join(ROOT, 'src/app/api/setup-admin')), false);
  assert.equal(existsSync(join(ROOT, 'src/app/setup-admin')), false);
});
