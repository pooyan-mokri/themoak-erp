import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { ROLE_LABELS } from '@/lib/permissions';
import { runTwice } from './sql';

// prisma/sql/datafix-2026-10-01-activity-role-names.sql: old log entries name a role by its code.

beforeEach(() => resetDatabase());
after(() => prisma.$disconnect());

test('a role code after «نقش» in a user creation or role change becomes its Persian name; nothing else changes', async () => {
  const log = (action: string, details: string) => prisma.activityLog.create({ data: { action, details } });
  const entries = [
    await log('CREATE_USER', 'کاربر علی با نقش PROJECT_MANAGER ایجاد شد.'),
    await log('CREATE_USER', 'کاربر سارا با نقش ADMIN ایجاد شد.'),
    await log('UPDATE_ROLE', 'نقش کاربر رضا به USER تغییر یافت.'),
    await log('UPDATE_USER', 'نقش ADMIN در متن ویرایش'), // another action: left
    await log('CREATE_USER', 'کاربر نیما با نقش فروشنده ایجاد شد.'), // already Persian
  ];
  await runTwice('datafix-2026-10-01-activity-role-names.sql', ['ActivityLog']);
  const details = await Promise.all(entries.map(async (e) => (await prisma.activityLog.findUniqueOrThrow({ where: { id: e.id } })).details));
  assert.deepEqual(details, [
    `کاربر علی با نقش ${ROLE_LABELS.PROJECT_MANAGER} ایجاد شد.`,
    `کاربر سارا با نقش ${ROLE_LABELS.ADMIN} ایجاد شد.`,
    `نقش کاربر رضا به ${ROLE_LABELS.USER} تغییر یافت.`,
    'نقش ADMIN در متن ویرایش',
    'کاربر نیما با نقش فروشنده ایجاد شد.',
  ]);
});
