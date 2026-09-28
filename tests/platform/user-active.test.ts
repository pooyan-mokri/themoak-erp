import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import nodemailer from 'nodemailer';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { ROLES } from '@/lib/permissions';
import { getUserOptions, getUsers, setUserActive, updateUserRole } from '@/actions/user';
import { getProjectById } from '@/actions/project';
import { getRecentActivities } from '@/actions/activity';
import { requestPasswordReset } from '@/actions/password-reset';

// The real Auth.js configuration (src/auth.ts), not the test stub that @/auth maps to.
const SECRET = 'test-secret-for-user-active-0123456789abcd';
process.env.AUTH_SECRET = SECRET;
const loadAuth = () => import('../../src/auth');
const COOKIE = 'authjs.session-token';
const PASSWORD = 'correct-horse-9';

console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
  // The signed-in admin of tests/stubs/auth.ts.
  await prisma.user.create({ data: { id: 'test-user', name: 'مدیر', email: 'admin@example.com', password: 'x', role: 'ADMIN' } });
});
after(() => prisma.$disconnect());

const staff = async (email = 'staff@example.com', role: 'SALES' | 'ADMIN' = 'SALES') =>
  prisma.user.create({ data: { name: 'Staff', email, password: await bcrypt.hash(PASSWORD, 10), role } });

async function signIn(email = 'staff@example.com'): Promise<string | null> {
  const { handlers } = await loadAuth();
  const csrf = await handlers.GET(new NextRequest('http://localhost:3000/api/auth/csrf'));
  const { csrfToken } = await csrf.json();
  const cookie = csrf.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const response = await handlers.POST(
    new NextRequest('http://localhost:3000/api/auth/callback/credentials', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, email, password: PASSWORD, callbackUrl: '/dashboard' }),
    }),
  );
  return response.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE}=`))?.split(';')[0] ?? null;
}

async function session(cookie: string) {
  const { handlers } = await loadAuth();
  const response = await handlers.GET(new NextRequest('http://localhost:3000/api/auth/session', { headers: { cookie } }));
  return response.json();
}

test('a deactivated user cannot sign in and their sessions end; reactivated, they sign in again', async () => {
  const user = await staff();
  const cookie = await signIn();
  assert.equal((await session(cookie!)).user.id, user.id);

  assert.deepEqual(await setUserActive(user.id, false), { success: true, message: 'کاربر غیرفعال شد؛ دیگر نمی‌تواند وارد شود.' });
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).isActive, false);
  assert.equal(await session(cookie!), null, 'the session ended');
  assert.equal(await signIn(), null, 'no new sign-in');

  assert.deepEqual(await setUserActive(user.id, true), { success: true, message: 'کاربر فعال شد.' });
  assert.ok(await signIn());
  const log = await prisma.activityLog.findMany({ where: { userId: 'test-user' }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(log.map((l: { details: string }) => l.details), ['کاربر Staff غیرفعال شد.', 'کاربر Staff دوباره فعال شد.']);
});

test('only an admin deactivates, never themself or the last active admin', async () => {
  const user = await staff();
  for (const role of [null, ...ROLES.filter((r) => r !== 'ADMIN')]) {
    setTestRole(role);
    assert.equal((await setUserActive(user.id, false)).success, false, String(role));
  }
  setTestRole('ADMIN');
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).isActive, true);
  assert.deepEqual(await setUserActive('test-user', false), { success: false, message: 'شما نمی‌توانید حساب خود را غیرفعال کنید.' });
  assert.equal((await setUserActive('no-such-user', false)).success, false);

  // Another admin may go only while an active one stays; an inactive admin does not count.
  const other = await staff('other@example.com', 'ADMIN');
  assert.equal((await setUserActive(other.id, false)).success, true);
  await prisma.user.update({ where: { id: 'test-user' }, data: { isActive: true } });
  assert.deepEqual(await updateUserRole('test-user', 'SALES' as any), {
    success: false,
    message: 'دست‌کم یک مدیر سیستم باید بماند؛ اول کاربر دیگری را مدیر سیستم کنید.',
  });
});

test('pickers leave a deactivated user out; the admin list, a task and the activity log still name them', async () => {
  const user = await staff();
  const project = await prisma.project.create({ data: { name: 'P' } });
  await prisma.task.create({ data: { title: 'T', projectId: project.id, assignedTo: user.id } });
  await prisma.activityLog.create({ data: { userId: user.id, action: 'X', details: 'y' } });
  await setUserActive(user.id, false);

  setTestRole('SALES');
  assert.deepEqual((await getUserOptions()).map((u) => u.name), ['مدیر']);
  assert.equal((await getProjectById(project.id))!.tasks[0].assignedToUser?.name, 'Staff');
  setTestRole('ADMIN');
  const listed = (await getUsers()).find((u: { id: string }) => u.id === user.id);
  assert.equal(listed?.isActive, false);
  assert.equal((await getRecentActivities()).find((a: { action: string }) => a.action === 'X')?.user?.name, 'Staff');
});

test('a deactivated user gets no reset link', async () => {
  await staff();
  const sent: unknown[] = [];
  (nodemailer as any).createTransport = () => ({ sendMail: async (mail: unknown) => void sent.push(mail) });
  Object.assign(process.env, { SMTP_HOST: 'smtp.example.test', SMTP_FROM: 'erp@example.test', AUTH_URL: 'https://erp.example.test' });
  try {
    await setUserActive((await prisma.user.findFirstOrThrow({ where: { email: 'staff@example.com' } })).id, false);
    const result = await requestPasswordReset(undefined, form({ email: 'staff@example.com' }));
    assert.equal(result.success, true, 'the same answer as for any address');
    assert.deepEqual(sent, []);
    assert.equal(await prisma.passwordResetToken.count(), 0);
  } finally {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;
  }
});

test('the column is created before db push with its default, and both user lists offer the switch', () => {
  const sql = readFileSync(join(process.cwd(), 'prisma/sql/pre-push-unique-columns.sql'), 'utf8');
  assert.match(sql, /ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;/);
  assert.match(readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8'), /\n  isActive\s+Boolean\s+@default\(true\)\n/);
  for (const file of ['src/components/settings/user-list.tsx', 'src/components/admin/user-list.tsx']) {
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    assert.match(source, /setUserActive\(/, file);
    assert.match(source, /غیرفعال کردن/, file);
  }
});
