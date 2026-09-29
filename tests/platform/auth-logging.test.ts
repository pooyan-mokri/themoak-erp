import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { encode } from 'next-auth/jwt';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase } from '../helpers/db';

const SECRET = 'test-secret-for-auth-logging-0123456789abcdef';
process.env.AUTH_SECRET = SECRET;
const COOKIE = 'authjs.session-token';
const EMAIL = 'private.person@example.com';
const PASSWORD = 'correct-horse-9';

// Everything written to the logs while signing in and reading the session.
let logged = '';
for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  console[level] = (...args: unknown[]) => {
    logged += args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n';
  };
}

beforeEach(async () => {
  await resetDatabase();
  logged = '';
});
after(() => prisma.$disconnect());

async function signIn(password: string) {
  const { handlers } = await import('../../src/auth');
  const csrf = await handlers.GET(new NextRequest('http://localhost:3000/api/auth/csrf'));
  const { csrfToken } = await csrf.json();
  const cookie = csrf.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  await handlers.POST(
    new NextRequest('http://localhost:3000/api/auth/callback/credentials', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, email: EMAIL, password, callbackUrl: '/dashboard' }),
    }),
  );
}

test('signing in, failing to and reading the session log no email, password result or session', async () => {
  const user = await prisma.user.create({ data: { name: 'Private Person', email: EMAIL, password: await bcrypt.hash(PASSWORD, 10), role: 'ADMIN' } });
  await signIn(PASSWORD);
  await signIn('wrong-password');
  const { handlers } = await import('../../src/auth');
  const jwt = await encode({ token: { id: user.id, role: 'ADMIN', email: EMAIL, name: user.name, sub: user.id }, secret: SECRET, salt: COOKIE });
  const session = await handlers.GET(new NextRequest('http://localhost:3000/api/auth/session', { headers: { cookie: `${COOKIE}=${jwt}` } }));
  assert.equal((await session.json()).user.email, EMAIL);

  assert.equal(logged.includes(EMAIL), false, logged);
  assert.equal(logged.includes('Private Person'), false);
  assert.doesNotMatch(logged, /Password match|AUTH DEBUG|Session created|Token:/);
});

test('the auth modules carry no debug logging', () => {
  for (const file of ['src/auth.ts', 'src/app/api/auth/[...nextauth]/route.ts']) {
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    assert.doesNotMatch(source, /console\.log|AUTH DEBUG/, file);
  }
});
