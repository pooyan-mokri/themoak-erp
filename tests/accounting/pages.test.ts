import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { recordInternalTransfer } from '@/actions/accounting';
import { getBreadcrumbs } from '@/lib/breadcrumbs';
import TransfersPage from '../../src/app/dashboard/accounting/transfers/page';
import DepositsPage from '../../src/app/dashboard/accounting/deposits/page';
import WithdrawalsPage from '../../src/app/dashboard/accounting/withdrawals/page';
import { TransferHistory } from '@/components/accounting/transfer-history';
import { openAccount } from './ledger';

// tsx compiles the page's JSX to React.createElement without importing React.
(globalThis as any).React = React;

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const APP = join(process.cwd(), 'src', 'app');

function propsOf(node: any, type: unknown): any {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = propsOf(child, type);
      if (found) return found;
    }
    return undefined;
  }
  if (node.type === type) return node.props;
  return propsOf(node.props?.children, type);
}

/** Resolves to the redirect target when fn redirects, or null when it returns. */
async function redirectOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error: any) {
    if (error?.message !== 'NEXT_REDIRECT') throw error;
    return String(error.digest).split(';')[2];
  }
}

const pageExists = (href: string) => existsSync(join(APP, ...href.split('/').filter(Boolean), 'page.tsx'));

function files(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path, pattern);
    return pattern.test(entry.name) ? [path] : [];
  });
}

test('/dashboard/accounting/transfers lists the transfers, with edit controls for the admin only', async () => {
  await openAccount('novin', 50_000_000);
  await openAccount('dehghani', 0);
  const recorded = await recordInternalTransfer(
    undefined,
    form({ amount: '43810000', fromAccountId: 'novin', toAccountId: 'dehghani', description: 'جهت خرید دلار' }),
  );
  assert.equal(recorded.success, true, recorded.message);

  let props = propsOf(await TransfersPage(), TransferHistory);
  assert.ok(props, 'the page renders the transfer list');
  assert.equal(props.isAdmin, true);
  assert.equal(props.transfers.length, 1);
  assert.equal(props.transfers[0].amount, 43_810_000);
  assert.ok(props.accounts.some((a: any) => a.id === 'novin'), 'the edit dialog gets the accounts');

  setTestRole('ACCOUNTANT');
  props = propsOf(await TransfersPage(), TransferHistory);
  assert.equal(props.isAdmin, false, 'correcting a recorded transfer stays admin-only');
});

test('/dashboard/accounting/deposits and /withdrawals open the journal instead of a 404', async () => {
  assert.equal(await redirectOf(() => DepositsPage()), '/dashboard/accounting/transactions');
  assert.equal(await redirectOf(() => WithdrawalsPage()), '/dashboard/accounting/transactions');
  assert.ok(pageExists('/dashboard/accounting/transactions'));
});

test('every breadcrumb on an accounting page links to a page that exists', () => {
  for (const page of files(join(APP, 'dashboard', 'accounting'), /^page\.tsx$/)) {
    const route = '/' + relative(APP, page).split(sep).slice(0, -1).join('/');
    for (const crumb of getBreadcrumbs(route)) {
      assert.ok(crumb.href && pageExists(crumb.href), `${route}: breadcrumb «${crumb.label}» → ${crumb.href}`);
    }
  }
  const labels = getBreadcrumbs('/dashboard/accounting/transfers/new').map((crumb) => crumb.label);
  assert.deepEqual(labels, ['حسابداری', 'انتقال وجه', 'جدید']);
});

test('every accounting link and redirect in the accounting pages and forms lands on a page that exists', () => {
  const sources = [
    ...files(join(process.cwd(), 'src', 'components', 'accounting'), /\.tsx?$/),
    ...files(join(APP, 'dashboard', 'accounting'), /\.tsx?$/),
  ];
  let checked = 0;
  for (const source of sources) {
    for (const [, href] of readFileSync(source, 'utf8').matchAll(/['"`](\/dashboard\/accounting[^'"`?#\s$]*)['"`]/g)) {
      assert.ok(pageExists(href), `${relative(process.cwd(), source)} links to ${href}, which has no page`);
      checked++;
    }
  }
  assert.ok(checked > 20, `only ${checked} links found`);
});
