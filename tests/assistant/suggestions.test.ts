import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestionGroups } from '@/components/assistant/assistant-suggestions';
import { ROLE_PERMISSIONS } from '@/lib/permissions';

const accessOf = (role: keyof typeof ROLE_PERMISSIONS) => {
  const has = (p: string) => (ROLE_PERMISSIONS[role] as readonly string[]).includes(p);
  return { stock: has('stock.view'), finance: has('finance.view'), salesManage: has('sales.manage') };
};

test('the assistant suggests only subjects whose tools the role may run', () => {
  assert.deepEqual(suggestionGroups(accessOf('ADMIN')).map((g) => g.id), ['stock', 'sales', 'finance', 'actions']);
  assert.deepEqual(suggestionGroups(accessOf('WAREHOUSE')).map((g) => g.id), ['stock']);
  assert.deepEqual(suggestionGroups(accessOf('SALES')).map((g) => g.id), ['stock', 'actions']);
  assert.deepEqual(suggestionGroups(accessOf('AUDITOR')).map((g) => g.id), ['stock', 'sales', 'finance']);
  assert.deepEqual(suggestionGroups(accessOf('USER')), []);
});
