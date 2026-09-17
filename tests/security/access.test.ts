import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import {
  AccessDenied,
  checkPermission,
  getCurrentRole,
  hasPermission,
  requirePagePermission,
  requirePermission,
} from '@/lib/access';
import { ALL_PERMISSIONS, can, ROLES } from '@/lib/permissions';
import { createUser, updateUserRole } from '@/actions/user';
import ReportsGuardLayout from '../../src/app/dashboard/accounting/reports/layout';

const DENIED = 'شما به این بخش دسترسی ندارید.';
const ROLES_AND_STRANGER = [...ROLES, null];

beforeEach(() => setTestRole('ADMIN'));
after(() => prisma.$disconnect());

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

test('getCurrentRole reads the session role, or null for a stranger', async () => {
  for (const role of ROLES_AND_STRANGER) {
    setTestRole(role);
    assert.equal(await getCurrentRole(), role);
  }
});

test('hasPermission, requirePermission and checkPermission follow the matrix for every role', async () => {
  for (const role of ROLES_AND_STRANGER) {
    setTestRole(role);
    for (const permission of ALL_PERMISSIONS) {
      const allowed = can(role, permission);
      const label = `${role} / ${permission}`;
      assert.equal(await hasPermission(permission), allowed, label);

      if (allowed) {
        await requirePermission(permission);
        assert.equal(await checkPermission(permission), null, label);
      } else {
        await assert.rejects(requirePermission(permission), (error: unknown) => {
          assert.ok(error instanceof AccessDenied, label);
          assert.equal(error.message, DENIED);
          assert.deepEqual(error.permissions, [permission]);
          return true;
        });
        assert.deepEqual(await checkPermission(permission), { success: false, error: DENIED, message: DENIED }, label);
      }
    }
  }
});

test('a list of permissions means any of them', async () => {
  setTestRole('SALES');
  assert.equal(await hasPermission(['cost.view', 'sales.view']), true);
  await requirePermission(['cost.view', 'sales.view']);
  setTestRole('WAREHOUSE');
  assert.equal(await hasPermission(['cost.view', 'sales.view']), false);
  await assert.rejects(requirePermission(['cost.view', 'sales.view']), AccessDenied);
});

test('requirePagePermission sends a refused user, or a stranger, to the no-access page', async () => {
  for (const role of ROLES_AND_STRANGER) {
    setTestRole(role);
    const target = await redirectOf(() => requirePagePermission('finance.view'));
    assert.equal(target, can(role, 'finance.view') ? null : '/dashboard/no-access', String(role));
  }
});

test('the accounting reports guard layout lets only profit viewers through', async () => {
  for (const role of ROLES_AND_STRANGER) {
    setTestRole(role);
    let rendered: unknown;
    const target = await redirectOf(async () => {
      rendered = await ReportsGuardLayout({ children: 'report' });
    });
    if (role === 'ADMIN' || role === 'AUDITOR') {
      assert.equal(target, null, String(role));
      assert.equal(rendered, 'report');
    } else {
      assert.equal(target, '/dashboard/no-access', String(role));
    }
  }
});

test('an admin can create an AUDITOR and move a user to or from AUDITOR', async () => {
  await resetDatabase();
  const created: { success?: boolean; message?: string } = await createUser(
    {},
    form({ name: 'Auditor', email: 'auditor@example.com', password: 'secret123', role: 'AUDITOR', phone: '' }),
  );
  assert.equal(created.success, true, created.message);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: 'auditor@example.com' } });
  assert.equal(user.role, 'AUDITOR');

  assert.equal((await updateUserRole(user.id, 'SALES' as any)).success, true);
  assert.equal((await updateUserRole(user.id, 'AUDITOR' as any)).success, true);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role, 'AUDITOR');
});
