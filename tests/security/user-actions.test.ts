import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { createUser, updateUser, updateUserRole, deleteUser, getUsers } from '@/actions/user';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

// The real form always sends phone (empty if blank); zod rejects a missing one as null.
const newAdmin = () => form({ name: 'Mallory', email: 'mallory@example.com', password: 'secret123', role: 'ADMIN', phone: '' });
const staff = () => prisma.user.create({ data: { name: 'Staff', email: 'staff@example.com', password: 'x', role: 'USER' } });

test('a signed-out caller or a non-admin cannot create a user, least of all an ADMIN', async () => {
  for (const role of [null, 'USER', 'SALES', 'ACCOUNTANT']) {
    setTestRole(role);
    const result: { success?: boolean; message?: string } = await createUser({}, newAdmin());
    assert.notEqual(result.success, true, `role ${role} must be refused`);
  }
  assert.equal(await prisma.user.count(), 0);
});

test('a non-admin cannot promote anyone, edit a user or delete one', async () => {
  const victim = await staff();
  for (const role of [null, 'USER', 'WAREHOUSE']) {
    setTestRole(role);
    assert.equal((await updateUserRole(victim.id, 'ADMIN' as any)).success, false);
    const edited: { success?: boolean } = await updateUser(victim.id, {}, form({ name: 'Staff', email: 'staff@example.com', role: 'ADMIN' }));
    assert.notEqual(edited.success, true);
    assert.equal((await deleteUser(victim.id)).success, false);
  }
  const after = await prisma.user.findUniqueOrThrow({ where: { id: victim.id } });
  assert.equal(after.role, 'USER');
});

test('an admin can still create, promote, edit and delete users', async () => {
  const created: { success?: boolean; message?: string } = await createUser(
    {},
    form({ name: 'New', email: 'new@example.com', password: 'secret123', role: 'SALES', phone: '' }),
  );
  assert.equal(created.success, true, created.message);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: 'new@example.com' } });

  assert.equal((await updateUserRole(user.id, 'ACCOUNTANT' as any)).success, true);
  const edited: { success?: boolean; message?: string } = await updateUser(
    user.id,
    {},
    form({ name: 'New Name', email: 'new@example.com', role: 'ACCOUNTANT', phone: '' }),
  );
  assert.equal(edited.success, true, edited.message);
  assert.equal((await deleteUser(user.id)).success, true);
  assert.equal(await prisma.user.count(), 0);
});

test('the user list is served to any signed-in user, never to a stranger', async () => {
  await staff();
  setTestRole(null);
  assert.deepEqual(await getUsers(), []);
  setTestRole('WAREHOUSE');
  assert.equal((await getUsers()).length, 1);
});
