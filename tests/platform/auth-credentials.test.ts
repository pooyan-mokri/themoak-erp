import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { decode } from 'next-auth/jwt';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase } from '../helpers/db';
import { authConfig } from '@/auth.config';

// The real Auth.js configuration (src/auth.ts), not the test stub that @/auth maps to.
const SECRET = 'test-secret-for-credentials-sign-in-0123456789';
process.env.AUTH_SECRET = SECRET;
const loadAuth = () => import('../../src/auth');
const COOKIE = 'authjs.session-token';

// src/auth.ts logs every step; the refusals below are on purpose.
console.log = () => {};
console.error = () => {};

beforeEach(() => resetDatabase());
after(() => prisma.$disconnect());

const PASSWORD = 'correct-horse-9';

async function staff(role: 'SALES' | 'ADMIN' | 'AUDITOR' = 'SALES', email = 'staff@example.com') {
  return prisma.user.create({ data: { name: 'Staff', email, password: await bcrypt.hash(PASSWORD, 10), role } });
}

/** What the login action does through signIn: the credentials callback, with its CSRF token. */
async function signInWith(fields: Record<string, string>) {
  const { handlers } = await loadAuth();
  const csrf = await handlers.GET(new NextRequest('http://localhost:3000/api/auth/csrf'));
  const { csrfToken } = await csrf.json();
  const cookie = csrf.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const response = await handlers.POST(
    new NextRequest('http://localhost:3000/api/auth/callback/credentials', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, callbackUrl: '/dashboard', ...fields }),
    }),
  );
  const setCookie = response.headers.getSetCookie();
  const session = setCookie.find((c) => c.startsWith(`${COOKIE}=`))?.split(';')[0].slice(COOKIE.length + 1);
  const token = session ? await decode({ token: session, secret: SECRET, salt: COOKIE }) : null;
  return { location: response.headers.get('location') ?? '', token };
}

test('the right email and password start a session carrying the user id and current role', async () => {
  const user = await staff('AUDITOR');
  const { location, token } = await signInWith({ email: 'staff@example.com', password: PASSWORD });
  assert.equal(location, 'http://localhost:3000/dashboard');
  assert.equal(token?.id, user.id);
  assert.equal(token?.role, 'AUDITOR');
  assert.equal(token?.email, 'staff@example.com');
  assert.equal(JSON.stringify(token).includes(user.password), false, 'the hash never goes into the cookie');
});

test('a wrong password, an unknown email or a missing field starts no session', async () => {
  await staff();
  const refused: Array<Record<string, string>> = [
    { email: 'staff@example.com', password: 'wrong-password' },
    { email: 'staff@example.com', password: PASSWORD.toUpperCase() },
    { email: 'nobody@example.com', password: PASSWORD },
    { email: 'staff@example.com', password: '' },
    { email: 'staff@example.com' },
    { password: PASSWORD },
    { email: '', password: '' },
    { email: 'not-an-email', password: PASSWORD },
    { email: "staff@example.com' OR '1'='1", password: PASSWORD },
  ];
  for (const fields of refused) {
    const { location, token } = await signInWith(fields);
    assert.equal(token, null, JSON.stringify(fields));
    assert.match(location, /\/login\?error=CredentialsSignin/, JSON.stringify(fields));
  }
});

test('a removed user can no longer sign in, and their old session ends', async () => {
  const user = await staff('ADMIN');
  const before = await signInWith({ email: 'staff@example.com', password: PASSWORD });
  assert.ok(before.token);

  await prisma.user.delete({ where: { id: user.id } });
  const after = await signInWith({ email: 'staff@example.com', password: PASSWORD });
  assert.equal(after.token, null);
  const { withCurrentRole } = await loadAuth();
  assert.equal(await withCurrentRole(before.token as any), null);
});

test('a role changed after sign-in is the role of the next request', async () => {
  const user = await staff('ADMIN');
  const { token } = await signInWith({ email: 'staff@example.com', password: PASSWORD });
  await prisma.user.update({ where: { id: user.id }, data: { role: 'SALES' } });
  const { withCurrentRole } = await loadAuth();
  assert.equal((await withCurrentRole(token as any))?.role, 'SALES');
});

test('a changed password stops the old one at the next sign-in', async () => {
  const user = await staff();
  await prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash('a-new-password', 10) } });
  assert.equal((await signInWith({ email: 'staff@example.com', password: PASSWORD })).token, null);
  assert.ok((await signInWith({ email: 'staff@example.com', password: 'a-new-password' })).token);
});

test('the middleware sends a stranger from the dashboard to login, and a signed-in user from login to the dashboard', () => {
  const authorized = (user: object | null, path: string) =>
    authConfig.callbacks.authorized({ auth: user ? { user, expires: '' } : null, request: { nextUrl: new URL(`http://localhost:3000${path}`) } } as any);

  assert.equal(authorized(null, '/dashboard'), false);
  assert.equal(authorized(null, '/dashboard/settings/users'), false);
  assert.equal(authorized(null, '/login'), true);
  assert.equal(authorized(null, '/forgot-password'), true);
  assert.equal(authorized(null, '/reset-password/abc'), true);
  assert.equal(authorized({ id: 'u1', role: 'SALES' }, '/dashboard/sales'), true);
  const bounced = authorized({ id: 'u1', role: 'SALES' }, '/login') as Response;
  assert.equal(bounced.headers.get('location'), 'http://localhost:3000/dashboard');
});
