import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { setTestRole } from '../stubs/auth';
import AdminPage from '@/app/dashboard/admin/page';
import SalesOrdersPage from '@/app/dashboard/sales/orders/page';
import { getBreadcrumbs } from '@/lib/breadcrumbs';

// The real-data crawl of 2026-10-01 found a link to an order page that does not exist
// (/dashboard/sales/orders/<id>) and breadcrumbs whose ancestors have no page (/dashboard/admin,
// /dashboard/sales/orders). Every dashboard link and every breadcrumb now leads to a page.

const SRC = join(process.cwd(), 'src');
const APP = join(SRC, 'app');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/** Every route with a page or a handler, as path segments ([id] matches any one segment). */
const ROUTES = walk(APP)
  .filter((f) => /\/(page\.tsx|route\.ts)$/.test(f))
  .map((f) => relative(APP, f).split('/').slice(0, -1).filter((s) => !/^\(.*\)$/.test(s)));

const exists = (path: string) => {
  const segments = path.split('/').filter(Boolean);
  return ROUTES.some((r) => r.length === segments.length && r.every((s, i) => s === segments[i] || s.startsWith('[') || segments[i] === '*'));
};

test('every link, push and redirect to a dashboard path names a page that exists', () => {
  const link = /(?:href=\{?\s*|href:\s*|push\(\s*|replace\(\s*|redirect\(\s*)(['"`])(\/dashboard[^'"`?#]*)\1/g;
  const broken: string[] = [];
  let checked = 0;
  for (const file of walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f))) {
    for (const match of readFileSync(file, 'utf8').matchAll(link)) {
      const path = match[2].replace(/\$\{[^}]*\}/g, '*').replace(/\/$/, '');
      // A path built further on (…/${id}-x) is not a whole route to check.
      const last = path.split('/').at(-1) ?? '';
      if (last.includes('*') && last !== '*') continue;
      checked++;
      if (!exists(path)) broken.push(`${relative(SRC, file)}: ${match[2]}`);
    }
  }
  assert.deepEqual(broken, []);
  assert.ok(checked > 100, `only ${checked} links checked`);
});

test('every breadcrumb of every dashboard page leads to a page', () => {
  const pages = walk(join(APP, 'dashboard'))
    .filter((f) => f.endsWith('/page.tsx'))
    .map((f) => `/${relative(APP, f).split('/').slice(0, -1).join('/')}`);
  const broken: string[] = [];
  for (const page of pages) {
    // A record id in place of each [param], as the browser has it.
    const url = page.replace(/\[[^\]]+\]/g, 'cmabcdefghijklmnopqrstu');
    for (const crumb of getBreadcrumbs(url)) {
      if (crumb.href && !exists(crumb.href.replace(/cmabcdefghijklmnopqrstu/g, '*'))) broken.push(`${page}: ${crumb.href}`);
    }
  }
  assert.deepEqual(broken, []);
});

test('the admin and orders crumbs send to their section, and only a role allowed in it', async () => {
  const target = async (page: () => Promise<unknown>) => {
    try {
      await page();
    } catch (error: any) {
      return String(error?.digest ?? error).split(';')[2];
    }
    return 'no redirect';
  };
  setTestRole('ADMIN');
  assert.equal(await target(AdminPage), '/dashboard/admin/users');
  assert.equal(await target(SalesOrdersPage), '/dashboard/sales/history');
  setTestRole('SALES');
  assert.equal(await target(AdminPage), '/dashboard/no-access');
  assert.equal(await target(SalesOrdersPage), '/dashboard/sales/history');
  setTestRole('WAREHOUSE');
  assert.equal(await target(SalesOrdersPage), '/dashboard/no-access');
  setTestRole('ADMIN');
});
