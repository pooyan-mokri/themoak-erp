import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ACTIVITY_LABELS, activityLabel } from '@/lib/activity-labels';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { ActivityFeed } from '@/components/admin/activity-feed';

// The real-data crawl found the CRM page showing raw ActivityLog codes (UPDATE_USER, REMOVE_RECEIPT, …).
// Every code the code base logs has a Persian name (src/lib/activity-labels.ts), and every screen of the log
// shows the name, never the code.

(globalThis as any).React = React;
const SRC = join(process.cwd(), 'src');

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

test('every action code passed to logActivity has a Persian name', () => {
  const codes = new Set<string>();
  for (const file of files(SRC)) {
    for (const call of readFileSync(file, 'utf8').matchAll(/(?<!function )logActivity\(\s*[^,]+,\s*([^,]+),/g)) {
      const literals = [...call[1].matchAll(/'([A-Z][A-Z_]+)'/g)].map((m) => m[1]);
      assert.ok(literals.length > 0, `${relative(SRC, file)}: logActivity with a code that is not a literal: ${call[1].trim()}`);
      literals.forEach((code) => codes.add(code));
    }
  }
  assert.ok(codes.size >= 15, `only ${codes.size} codes found`);
  assert.deepEqual([...codes].filter((code) => !ACTIVITY_LABELS[code]).sort(), []);
  for (const label of Object.values(ACTIVITY_LABELS)) assert.match(label, /^[؀-ۿ‌ ]+$/, label);
  assert.equal(activityLabel('SOMETHING_NEW'), 'فعالیت');
});

test('no screen shows an activity code: each goes through activityLabel', () => {
  for (const file of files(SRC)) {
    const source = readFileSync(file, 'utf8');
    assert.ok(!/\{\s*\w+\.action\s*\}/.test(source), `${relative(SRC, file)} renders an action code as it is`);
  }
  const at = new Date('2026-09-30T08:00:00Z');
  const dashboard = renderToStaticMarkup(
    React.createElement(RecentActivity, { activities: [{ id: '1', userName: 'مدیر', action: 'REMOVE_RECEIPT', description: 'رسید حذف شد', timestamp: at }] }),
  );
  const users = renderToStaticMarkup(
    React.createElement(ActivityFeed, { activities: [{ id: '1', action: 'UPDATE_USER', details: 'ویرایش شد', createdAt: at, user: { name: 'مدیر' } }] }),
  );
  assert.ok(dashboard.includes('حذف رسید') && !dashboard.includes('REMOVE_RECEIPT'));
  assert.ok(users.includes('ویرایش کاربر') && !users.includes('UPDATE_USER'));
});
