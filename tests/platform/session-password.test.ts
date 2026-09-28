import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { changePassword, setUserPassword } from '@/actions/user';
import { ROLES } from '@/lib/permissions';
import { resetPassword } from '@/actions/password-reset';

// The real Auth.js configuration (src/auth.ts), not the test stub that @/auth maps to.
const SECRET = 'test-secret-for-session-password-0123456789';
process.env.AUTH_SECRET = SECRET;
const loadAuth = () => import('../../src/auth');
const COOKIE = 'authjs.session-token';
const PASSWORD = 'correct-horse-9';

console.error = () => {};

beforeEach(async () => {
  setTestRole('SALES');
  await resetDatabase();
});
after(() => prisma.$disconnect());

// The stub's signed-in user is test-user: the one whose password changes.
const me = async () =>
  prisma.user.create({ data: { id: 'test-user', name: 'Me', email: 'me@example.com', password: await bcrypt.hash(PASSWORD, 10), role: 'SALES' } });

/** Signs in through the credentials callback and returns the session cookie. */
async function signIn(password = PASSWORD): Promise<string | null> {
  const { handlers } = await loadAuth();
  const csrf = await handlers.GET(new NextRequest('http://localhost:3000/api/auth/csrf'));
  const { csrfToken } = await csrf.json();
  const cookie = csrf.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const response = await handlers.POST(
    new NextRequest('http://localhost:3000/api/auth/callback/credentials', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, email: 'me@example.com', password, callbackUrl: '/dashboard' }),
    }),
  );
  return response.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE}=`))?.split(';')[0] ?? null;
}

/** What useSession() and every server page read: GET /api/auth/session with the cookie. */
async function session(cookie: string) {
  const { handlers } = await loadAuth();
  const response = await handlers.GET(new NextRequest('http://localhost:3000/api/auth/session', { headers: { cookie } }));
  return { body: await response.json(), setCookie: response.headers.getSetCookie().join('\n') };
}

const nextSecond = () => new Promise((resolve) => setTimeout(resolve, 1100));

test('changing one\'s own password ends every session from before, and the new password signs in', async () => {
  await me();
  const phone = await signIn();
  const laptop = await signIn();
  assert.ok(phone && laptop);
  assert.equal((await session(phone!)).body.user.id, 'test-user');

  await nextSecond();
  const changed: any = await changePassword({}, form({ currentPassword: PASSWORD, newPassword: 'brand-new-pass', confirmPassword: 'brand-new-pass' }));
  assert.deepEqual(changed, { message: 'رمز عبور با موفقیت تغییر یافت. با رمز تازه دوباره وارد شوید.', success: true });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: 'test-user' } });
  assert.ok(user.passwordChangedAt && Date.now() - user.passwordChangedAt.getTime() < 5_000);

  for (const cookie of [phone!, laptop!]) {
    const read = await session(cookie);
    assert.equal(read.body, null);
    assert.match(read.setCookie, new RegExp(`${COOKIE}=;`));
  }
  assert.equal(await signIn(PASSWORD), null);
  const fresh = await signIn('brand-new-pass');
  assert.equal((await session(fresh!)).body.user.id, 'test-user', 'a sign-in in the second of the change still counts');
});

test('a reset link ends the sessions signed in before it', async () => {
  const user = await me();
  const before = await signIn();
  await prisma.passwordResetToken.create({ data: { userId: user.id, token: 'a'.repeat(64), expiresAt: new Date(Date.now() + 3_600_000) } });
  await nextSecond();
  assert.equal((await resetPassword('a'.repeat(64), undefined, form({ password: 'reset-pass-1', confirmPassword: 'reset-pass-1' }))).success, true);
  assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordChangedAt);
  assert.equal((await session(before!)).body, null);
  assert.ok(await signIn('reset-pass-1'));
});

test('the check is by whole seconds of the token\'s last use', async () => {
  await me();
  const { withCurrentRole } = await loadAuth();
  const changedAt = new Date('2026-09-28T10:00:00.700Z');
  await prisma.user.update({ where: { id: 'test-user' }, data: { passwordChangedAt: changedAt } });
  const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
  const token = (iat?: number) => ({ id: 'test-user', role: 'SALES' as any, ...(iat === undefined ? {} : { iat }) });
  assert.equal(await withCurrentRole(token(at('2026-09-28T09:59:59.999Z'))), null);
  assert.equal((await withCurrentRole(token(at('2026-09-28T10:00:00.000Z'))))?.role, 'SALES');
  assert.equal((await withCurrentRole(token(at('2026-09-28T10:05:00.000Z'))))?.role, 'SALES');
  assert.equal(await withCurrentRole(token()), null, 'a token that does not say when it was issued');
  // A user whose password never changed keeps every session.
  await prisma.user.update({ where: { id: 'test-user' }, data: { passwordChangedAt: null } });
  assert.equal((await withCurrentRole(token()))?.role, 'SALES');
});

test('the column is created before db push, with the short lock timeout, as Prisma names it', () => {
  const sql = readFileSync(join(process.cwd(), 'prisma/sql/pre-push-unique-columns.sql'), 'utf8');
  assert.match(sql, /ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP\(3\);/);
  assert.ok(sql.indexOf("set_config('lock_timeout', '5s', true)") < sql.indexOf('"passwordChangedAt"'));
  assert.match(readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8'), /\n  passwordChangedAt\s+DateTime\?\n/);
  assert.match(readFileSync(join(process.cwd(), 'src/components/settings/password-form.tsx'), 'utf8'), /await signOut\(\{ callbackUrl: '\/login' \}\)/);
});

test('an admin sets another user\'s password: their sessions end, the new one signs in, and the log says so in Persian', async () => {
  // The stub signs in test-user: here the admin. The staff member signs in as me@example.com.
  const staff = await prisma.user.create({
    data: { id: 'staff-user', name: 'Me', email: 'me@example.com', password: await bcrypt.hash(PASSWORD, 10), role: 'SALES' },
  });
  await prisma.user.create({ data: { id: 'test-user', name: 'مدیر', email: 'admin@example.com', password: 'x', role: 'ADMIN' } });
  const before = await signIn();
  assert.equal((await session(before!)).body.user.id, staff.id);
  await nextSecond();
  const set = (userId: string, newPassword: string, confirmPassword = newPassword) =>
    setUserPassword(userId, null, form({ newPassword, confirmPassword })) as Promise<any>;

  // Nobody but an admin, and nothing changes.
  for (const role of [null, ...ROLES.filter((r) => r !== 'ADMIN')]) {
    setTestRole(role);
    assert.deepEqual(await set(staff.id, 'hijacked-pass'), { success: false, message: 'فقط مدیر سیستم می‌تواند کاربران را مدیریت کند.' }, String(role));
  }
  setTestRole('ADMIN');
  assert.equal((await set(staff.id, '12345')).success, false);
  assert.equal((await set(staff.id, 'new-pass-1', 'new-pass-2')).success, false);
  assert.deepEqual(await set('no-such-user', 'new-pass-1'), { success: false, message: 'خطا در تغییر رمز عبور.' });
  // One's own password goes through the profile page, with the current one.
  assert.deepEqual(await set('test-user', 'new-pass-1'), { success: false, message: 'رمز عبور خودتان را از «پروفایل من» تغییر دهید.' });
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: staff.id } })).passwordChangedAt, null);
  assert.ok((await session(before!)).body, 'refusals leave the session');

  const done = await set(staff.id, 'admin-set-pass');
  assert.deepEqual(done, { success: true, message: 'رمز عبور کاربر تغییر یافت؛ او باید با رمز تازه وارد شود.' });
  assert.equal((await session(before!)).body, null, 'their session ended');
  assert.equal(await signIn(PASSWORD), null);
  assert.ok(await signIn('admin-set-pass'));
  const log = await prisma.activityLog.findFirstOrThrow({ where: { action: 'SET_PASSWORD' } });
  assert.deepEqual([log.userId, log.details], ['test-user', 'رمز عبور کاربر Me توسط مدیر سیستم تغییر یافت.']);
});

test('the users page offers the set-password dialog', () => {
  const list = readFileSync(join(process.cwd(), 'src/components/settings/user-list.tsx'), 'utf8');
  assert.match(list, /<SetPasswordDialog user=\{passwordUser\}/);
  assert.match(readFileSync(join(process.cwd(), 'src/components/settings/set-password-dialog.tsx'), 'utf8'), /setUserPassword\(user\.id, null, /);
});
