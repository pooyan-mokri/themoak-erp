import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { Role } from '@prisma/client';
import {
  ALL_PERMISSIONS,
  can,
  canAccessRoute,
  describeRole,
  NAV_WHILE_LOADING,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROLES,
  ROUTE_PERMISSIONS,
  routePermissions,
  type Permission,
} from '@/lib/permissions';

const ROOT = process.cwd();
const APP = join(ROOT, 'src/app');

// The matrix the owner approved, column by column:
// ADMIN, AUDITOR, ACCOUNTANT, SALES, WAREHOUSE, PROJECT_MANAGER, USER.
const COLUMNS = ['ADMIN', 'AUDITOR', 'ACCOUNTANT', 'SALES', 'WAREHOUSE', 'PROJECT_MANAGER', 'USER'];
const APPROVED: Record<Permission, string> = {
  'cost.view':       'YY-----',
  'cost.edit':       'Y------',
  'profit.view':     'YY-----',
  'finance.view':    'YYY----',
  'finance.manage':  'Y-Y----',
  'payroll.view':    'YYY----',
  'payroll.manage':  'Y-Y----',
  'accounts.pick':   'YYYY---',
  'sales.view':      'YYYY---',
  'sales.manage':    'Y-YY---',
  'stock.view':      'YYYYY--',
  'stock.manage':    'Y---Y--',
  'users.manage':    'Y------',
  'settings.manage': 'Y------',
  'projects.manage': 'Y-YYYYY',
};

test('every role and permission pair matches the approved matrix exactly', () => {
  assert.deepEqual([...ALL_PERMISSIONS].sort(), Object.keys(APPROVED).sort());
  assert.deepEqual(Object.keys(ROLE_PERMISSIONS).sort(), [...COLUMNS].sort());
  for (const [permission, row] of Object.entries(APPROVED) as [Permission, string][]) {
    COLUMNS.forEach((role, i) => {
      assert.equal(can(role, permission), row[i] === 'Y', `${role} / ${permission}`);
    });
  }
});

test('the matrix covers exactly the roles in the Prisma enum, with AUDITOR among them', () => {
  assert.deepEqual([...ROLES].sort(), Object.values(Role).sort());
  assert.ok(ROLES.includes('AUDITOR' as Role));
});

test('AUDITOR is read-only and ACCOUNTANT never sees cost or profit', () => {
  const writes = ALL_PERMISSIONS.filter((p) => !p.endsWith('.view') && p !== 'accounts.pick');
  for (const p of writes) assert.equal(can('AUDITOR', p), false, p);
  for (const p of ['cost.view', 'cost.edit', 'profit.view'] as Permission[]) assert.equal(can('ACCOUNTANT', p), false, p);
});

test('a missing, unknown or prototype role holds no permission', () => {
  for (const role of [null, undefined, '', 'admin', 'SUPERUSER', 'constructor', '__proto__', 'toString']) {
    for (const p of ALL_PERMISSIONS) assert.equal(can(role, p), false, `${String(role)} / ${p}`);
  }
});

test('role labels are the approved Persian names', () => {
  assert.deepEqual(ROLE_LABELS, {
    ADMIN: 'مدیر سیستم',
    AUDITOR: 'حسابرس',
    ACCOUNTANT: 'حسابدار',
    SALES: 'فروشنده',
    WAREHOUSE: 'انباردار',
    PROJECT_MANAGER: 'مدیر پروژه',
    USER: 'کاربر عادی',
  });
});

test('role descriptions follow the matrix', () => {
  assert.match(describeRole('AUDITOR').join(' '), /فقط مشاهده/);
  assert.match(describeRole('ACCOUNTANT').join(' '), /بهای تمام‌شده و سود را نمی‌بیند/);
  assert.doesNotMatch(describeRole('ADMIN').join(' '), /نمی‌بیند/);
  assert.equal(describeRole('USER').length, 1);
});

const isDir = (path: string) => existsSync(path) && statSync(path).isDirectory();

function walk(dir: string, name: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path, name);
    return entry === name ? [path] : [];
  });
}

const routeOf = (file: string) => '/' + relative(APP, file).split(sep).slice(0, -1).join('/');

test('every ROUTE_PERMISSIONS prefix is a real route folder with pages in it', () => {
  for (const prefix of Object.keys(ROUTE_PERMISSIONS)) {
    const dir = join(APP, prefix);
    assert.ok(isDir(dir), `${prefix} is not a folder under src/app`);
    assert.ok(walk(dir, 'page.tsx').length > 0, `${prefix} has no page`);
  }
});

test('every prefix has a guard layout for itself, and every guard layout names its own folder', () => {
  for (const prefix of Object.keys(ROUTE_PERMISSIONS)) {
    const layout = join(APP, prefix, 'layout.tsx');
    assert.ok(existsSync(layout), `${prefix} has no layout.tsx`);
    assert.ok(readFileSync(layout, 'utf8').includes(`await requireRouteAccess('${prefix}')`), `${prefix}/layout.tsx does not guard it`);
  }
  for (const layout of walk(join(APP, 'dashboard'), 'layout.tsx')) {
    for (const [, named] of readFileSync(layout, 'utf8').matchAll(/requireRouteAccess\('([^']+)'\)/g)) {
      assert.equal(named, routeOf(layout), `${relative(ROOT, layout)} guards the wrong prefix`);
    }
  }
});

test('every server page below a prefix checks its longest prefix before doing anything else', () => {
  // A redirect in a layout does not stop Next from rendering the page and sending its
  // data, so the page itself must refuse. Client pages only get data through actions.
  const prefixes = Object.keys(ROUTE_PERMISSIONS);
  let guarded = 0;
  for (const page of walk(join(APP, 'dashboard'), 'page.tsx')) {
    const route = routeOf(page);
    const prefix = prefixes.filter((p) => route === p || route.startsWith(`${p}/`)).sort((a, b) => b.length - a.length)[0];
    const source = readFileSync(page, 'utf8');
    const calls = [...source.matchAll(/requireRouteAccess\('([^']+)'\)/g)].map((m) => m[1]);
    if (!prefix) {
      assert.deepEqual(calls, [], `${route} is open to everyone but guards itself`);
      continue;
    }
    if (/^\s*['"]use client['"]/.test(source)) continue;
    const body = source.match(/export default async function \w+\([^]*?\)\s*\{\s*([^\n]*)/);
    assert.equal(body?.[1], `await requireRouteAccess('${prefix}');`, `${route} must start with the ${prefix} guard`);
    assert.deepEqual(calls, [prefix], route);
    guarded++;
  }
  assert.ok(guarded >= 90, `only ${guarded} guarded pages`);
});

test('a child route never admits a role its parent layout refuses', () => {
  // Nested layouts all run, so the longest prefix only decides access if parents are at least as open.
  const prefixes = Object.keys(ROUTE_PERMISSIONS) as (keyof typeof ROUTE_PERMISSIONS)[];
  for (const child of prefixes) {
    for (const parent of prefixes) {
      if (child === parent || !child.startsWith(`${parent}/`)) continue;
      for (const role of ROLES) {
        if (canAccessRoute(role, child)) assert.ok(canAccessRoute(role, parent), `${role} passes ${child} but not ${parent}`);
      }
    }
  }
});

test('the longest matching prefix decides, on whole path segments only', () => {
  assert.deepEqual(routePermissions('/dashboard/accounting/reports'), ['profit.view']);
  assert.deepEqual(routePermissions('/dashboard/accounting/reports/x'), ['profit.view']);
  assert.deepEqual(routePermissions('/dashboard/accounting/accounts'), ['finance.view']);
  assert.deepEqual(routePermissions('/dashboard/accounting/shareholders'), ['finance.view']);
  assert.deepEqual(routePermissions('/dashboard/accounting/shareholders/profits'), ['profit.view']);
  assert.deepEqual(routePermissions('/dashboard/sales/pos'), ['sales.view']);
  assert.equal(routePermissions('/dashboard/salesforce'), null);
  assert.equal(routePermissions('/dashboard'), null);
  assert.equal(routePermissions('/dashboard/projects/abc'), null);
  assert.equal(routePermissions('/dashboard/settings/profile'), null);
  assert.equal(canAccessRoute('ACCOUNTANT', '/dashboard/accounting/reports'), false);
  assert.equal(canAccessRoute('AUDITOR', '/dashboard/accounting/reports'), true);
  assert.equal(canAccessRoute('SALES', '/dashboard/sales/analytics'), false);
  assert.equal(canAccessRoute('WAREHOUSE', '/dashboard/inventory/reports'), false);
  assert.equal(canAccessRoute('WAREHOUSE', '/dashboard/inventory/products/new'), true);
});

const EVERYONE = ['/dashboard', '/dashboard/projects', '/dashboard/assistant', '/dashboard/settings'];
const MENU: Record<string, string[]> = {
  ADMIN: ['*'],
  AUDITOR: ['*'],
  ACCOUNTANT: ['*'],
  SALES: [...EVERYONE, '/dashboard/inventory', '/dashboard/crm', '/dashboard/sales', '/dashboard/suppliers', '/dashboard/marketing', '/dashboard/reports', '/dashboard/search'],
  WAREHOUSE: [...EVERYONE, '/dashboard/inventory', '/dashboard/suppliers', '/dashboard/search'],
  PROJECT_MANAGER: EVERYONE,
  USER: EVERYONE,
};

for (const file of ['src/components/layout/sidebar.tsx', 'src/components/layout/mobile-menu.tsx']) {
  test(`${file} shows each role exactly its sections, and only safe items while loading`, () => {
    const source = readFileSync(join(ROOT, file), 'utf8');
    assert.ok(source.includes('canAccessRoute(session?.user?.role, route.href)'), 'menu is not filtered by role');
    assert.ok(source.includes('{visibleRoutes.map('), 'menu renders the unfiltered list');
    const hrefs = [...source.matchAll(/href: '([^']+)'/g)].map((m) => m[1]);
    assert.ok(hrefs.length >= 13);
    for (const href of hrefs) assert.ok(isDir(join(APP, href)), `${href} is not a route`);
    for (const role of ROLES) {
      const expected = MENU[role][0] === '*' ? hrefs : hrefs.filter((h) => MENU[role].includes(h));
      assert.deepEqual(hrefs.filter((h) => canAccessRoute(role, h)), expected, role);
    }
    assert.deepEqual(hrefs.filter((h) => NAV_WHILE_LOADING.includes(h)), ['/dashboard', '/dashboard/settings']);
  });
}

test('every role picker, label map and filter lists roles from ROLE_LABELS, so AUDITOR is offered', () => {
  const files = [
    'src/components/settings/user-form.tsx',
    'src/components/settings/user-list.tsx',
    'src/components/admin/user-form.tsx',
    'src/components/admin/user-list.tsx',
  ];
  for (const file of files) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    assert.match(source, /from '@\/lib\/permissions'/, file);
    assert.match(source, /ROLES\.map\(/, file);
    assert.match(source, /ROLE_LABELS\[/, file);
    // No hand-written role list left to fall out of date.
    for (const label of ['حسابدار', 'انباردار', 'مدیر پروژه', 'کاربر عادی']) {
      assert.equal(source.includes(`>${label}<`) || source.includes(`'${label}'`), false, `${file} hardcodes ${label}`);
    }
  }
  assert.match(readFileSync(join(ROOT, files[1]), 'utf8'), /\[Role\.AUDITOR\]/);
  for (const file of [files[0], files[2]]) assert.match(readFileSync(join(ROOT, file), 'utf8'), /describeRole\(role\)/, file);
});
