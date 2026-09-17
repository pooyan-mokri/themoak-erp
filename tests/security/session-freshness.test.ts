import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { encode } from 'next-auth/jwt';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase } from '../helpers/db';

// The real Auth.js configuration, not the test stub that @/auth maps to.
const SECRET = 'test-secret-for-session-freshness-0123456789';
process.env.AUTH_SECRET = SECRET;
const loadAuth = () => import('../../src/auth');

const COOKIE = 'authjs.session-token';

beforeEach(() => resetDatabase());
after(() => prisma.$disconnect());

const staff = (role: 'SALES' | 'ADMIN' = 'SALES') =>
  prisma.user.create({ data: { name: 'Staff', email: 'staff@example.com', password: 'x', role } });

test('withCurrentRole replaces the role copied at login with the current one', async () => {
  const { withCurrentRole } = await loadAuth();
  const user = await staff('ADMIN');
  const token = { id: user.id, role: 'ADMIN' as any, email: user.email, name: user.name };

  await prisma.user.update({ where: { id: user.id }, data: { role: 'AUDITOR' } });
  assert.deepEqual(await withCurrentRole(token), { ...token, role: 'AUDITOR' });

  await prisma.user.delete({ where: { id: user.id } });
  assert.equal(await withCurrentRole(token), null);
  assert.equal(await withCurrentRole({ role: 'ADMIN' } as any), null);
});

/** What useSession() fetches: GET /api/auth/session with the browser's session cookie. */
async function readSession(token: Record<string, unknown>) {
  const { handlers } = await loadAuth();
  const jwt = await encode({ token, secret: SECRET, salt: COOKIE });
  const response = await handlers.GET(
    new NextRequest('http://localhost:3000/api/auth/session', { headers: { cookie: `${COOKIE}=${jwt}` } }),
  );
  return { body: await response.json(), setCookie: response.headers.getSetCookie().join('\n') };
}

test('a role change shows in the session on the next request, without logging out', async () => {
  const user = await staff('ADMIN');
  const token = { id: user.id, role: 'ADMIN', email: user.email, name: user.name, sub: user.id };

  assert.equal((await readSession(token)).body.user.role, 'ADMIN');
  await prisma.user.update({ where: { id: user.id }, data: { role: 'SALES' } });
  const { body, setCookie } = await readSession(token);
  assert.equal(body.user.role, 'SALES');
  assert.equal(body.user.id, user.id);
  // The re-issued cookie carries the new role.
  assert.match(setCookie, new RegExp(`${COOKIE}=[^;]+`));
});

test('a deleted user is signed out on the next request and the session cookie is cleared', async () => {
  const user = await staff();
  const token = { id: user.id, role: 'SALES', email: user.email, name: user.name, sub: user.id };
  await prisma.user.delete({ where: { id: user.id } });

  const { body, setCookie } = await readSession(token);
  assert.equal(body, null);
  assert.match(setCookie, new RegExp(`${COOKIE}=;`));
});
