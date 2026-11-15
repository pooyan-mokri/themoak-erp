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

test('Next.js is at least 15.5.28: Liara refuses to build anything older (React2Shell, CVE-2025-55182 and CVE-2026-75604)', () => {
  // 2026-11-15: Liara's build stopped every deploy on 14.2.35: «upgrade Next.js to 16.4.1 or later (or 15.5.28 or
  // later if you stay on 15.x)». Those releases also carry the 14.2.x fixes above.
  const [major, minor, patch] = (require('next/package.json').version as string).split('.').map(Number);
  assert.ok(major > 15 || (major === 15 && (minor > 5 || (minor === 5 && patch >= 28))), `next ${major}.${minor}.${patch}`);
  assert.equal(require('../../package.json').dependencies.next, require('next/package.json').version, 'the exact version, as Liara checks it');
});
