// 2026-10-24: erp.themoak.com/login showed everyone a cached 500 page. On Next 14.2.3 one request carrying
// `x-now-route-matches` (a Vercel-only header that reaches a Liara server from anyone) made Next render the page as
// static, fail (it reads searchParams) and keep serving that failure from its cache (CVE-2024-46982). Fixed in 14.2.10;
// 14.2.25 also stops `x-middleware-subrequest` from skipping the middleware (CVE-2025-29927).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as loginPage from '../../src/app/login/page';
import * as homePage from '../../src/app/page';

const require = createRequire(import.meta.url);

test('the login page and the home page (which reads the session) render for each request and are never cached', () => {
  assert.equal(loginPage.dynamic, 'force-dynamic');
  assert.equal(homePage.dynamic, 'force-dynamic');
});

test('Next.js is at least 14.2.25: no cache poisoning by header, no middleware skip', () => {
  const [major, minor, patch] = (require('next/package.json').version as string).split('.').map(Number);
  assert.ok(major > 14 || (major === 14 && (minor > 2 || (minor === 2 && patch >= 25))), `next ${major}.${minor}.${patch}`);
});
