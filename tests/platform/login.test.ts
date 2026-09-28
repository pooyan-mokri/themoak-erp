import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CredentialsSignin } from 'next-auth';
import { form } from '../helpers/db';
import { setTestSignIn } from '../stubs/auth';
import { authenticate } from '@/actions/login';
import { loginRedirectPath } from '@/lib/login-redirect';

// The action logs every failed sign-in these tests provoke on purpose.
console.error = () => {};

let calls: Array<[string, Record<string, unknown>]> = [];
beforeEach(() => {
  calls = [];
  setTestSignIn(async (provider, options) => {
    calls.push([provider, options]);
    return 'http://localhost:3000/dashboard';
  });
});
after(() => setTestSignIn(async () => undefined));

test('after sign-in only a dashboard path from the callbackUrl is kept, never another host', () => {
  const cases: Array<[unknown, string]> = [
    [undefined, '/dashboard'], // no referer, no callbackUrl
    [null, '/dashboard'],
    ['', '/dashboard'],
    ['/dashboard/sales/orders?page=2', '/dashboard/sales/orders?page=2'], // a relative path
    ['http://localhost:3200/dashboard', '/dashboard'], // absolute, same host
    ['https://erp.themoak.com/dashboard/accounting/loans', '/dashboard/accounting/loans'],
    ['https://evil.example/dashboard/x', '/dashboard/x'], // a foreign host: its path only, on our host
    ['/dashboardx', '/dashboard'],
    ['/dashboard-evil', '/dashboard'],
    ['//evil.com/dashboard', '/dashboard'],
    ['//evil.com/login', '/dashboard'],
    ['\\\\evil.com\\dashboard\\x', '/dashboard/x'],
    ['javascript:alert(1)', '/dashboard'],
    ['javascript://dashboard/%0aalert(1)', '/dashboard'],
    ['http://[', '/dashboard'], // malformed
    ['/login', '/dashboard'],
    ['/dashboard/../login', '/dashboard'],
    ['/api/backups/backup-2026-09-24T00-00-00.sql', '/dashboard'],
    [['/dashboard/sales'], '/dashboard'],
    [42, '/dashboard'],
  ];
  for (const [callbackUrl, expected] of cases) {
    const path = loginRedirectPath(callbackUrl);
    assert.equal(path, expected, String(callbackUrl));
    assert.ok(path.startsWith('/dashboard') && !path.startsWith('//'), String(callbackUrl));
  }
});

test('a good sign-in answers with the landing path and sets no server redirect', async () => {
  const result = await authenticate(
    undefined,
    form({ email: 'staff@example.com', password: 'secret123', callbackUrl: 'http://localhost:3200/dashboard/projects' }),
  );
  assert.deepEqual(result, { redirectTo: '/dashboard/projects' });
  assert.equal(calls.length, 1);
  const [provider, options] = calls[0];
  assert.equal(provider, 'credentials');
  // No redirect from the action: the page loads the landing path in full, so the
  // browser shows its address and the session provider starts signed in.
  assert.deepEqual(options, { email: 'staff@example.com', password: 'secret123', redirectTo: '/dashboard/projects', redirect: false });
});

test('without a callbackUrl the landing path is the dashboard', async () => {
  assert.deepEqual(await authenticate(undefined, form({ email: 'a@example.com', password: 'secret123' })), { redirectTo: '/dashboard' });
  assert.deepEqual(
    await authenticate(undefined, form({ email: 'a@example.com', password: 'secret123', callbackUrl: 'https://evil.example/login' })),
    { redirectTo: '/dashboard' },
  );
});

test('wrong credentials and any other failure answer in Persian, with nowhere to go', async () => {
  setTestSignIn(async () => {
    throw new CredentialsSignin();
  });
  assert.deepEqual(await authenticate(undefined, form({ email: 'a@example.com', password: 'nope-nope' })), {
    error: 'ایمیل یا رمز عبور اشتباه است.',
  });

  setTestSignIn(async () => {
    throw new Error('database unreachable');
  });
  const failed = await authenticate(undefined, form({ email: 'a@example.com', password: 'secret123' }));
  assert.deepEqual(failed, { error: 'ورود انجام نشد؛ لطفاً دوباره تلاش کنید.' });
  assert.doesNotMatch(failed?.error ?? '', /[A-Za-z]/, 'no English reaches the login page');
});

test('the login page sends the callbackUrl and loads the landing path in full', () => {
  const page = readFileSync(join(process.cwd(), 'src/app/login/page.tsx'), 'utf8');
  assert.match(page, /name="callbackUrl" value=\{searchParams\?\.callbackUrl \?\? ''\}/);
  assert.match(page, /window\.location\.assign\(state\.redirectTo\)/);
  assert.doesNotMatch(page, /router\.(push|replace)/, 'a client navigation keeps the signed-out session provider');
});
