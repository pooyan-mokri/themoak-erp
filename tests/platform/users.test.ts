import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { ROLES } from '@/lib/permissions';
import {
  changePassword,
  createUser,
  deleteUser,
  getUsers,
  updateProfile,
  updateUser,
  updateUserRole,
} from '@/actions/user';

// The actions log the database errors these tests provoke on purpose.
console.error = () => {};

const NON_ADMINS = [null, ...ROLES.filter((role) => role !== 'ADMIN')];
const LAST_ADMIN = 'دست‌کم یک مدیر سیستم باید بماند؛ اول کاربر دیگری را مدیر سیستم کنید.';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
  // The signed-in user of tests/stubs/auth.ts, so the activity log can name them.
  await prisma.user.create({
    data: { id: 'test-user', name: 'مدیر', email: 'admin@example.com', password: await bcrypt.hash('admin-pass-1', 10), role: 'ADMIN' },
  });
});
after(() => prisma.$disconnect());

const newUser = (fields: Record<string, string> = {}) =>
  form({ name: 'سارا', email: 'sara@example.com', password: 'secret123', role: 'SALES', phone: '09120000000', ...fields });
const snapshot = () => prisma.user.findMany({ orderBy: { email: 'asc' } });
const staff = (role: 'SALES' | 'ADMIN' | 'AUDITOR' = 'SALES', email = 'staff@example.com') =>
  prisma.user.create({ data: { name: 'Staff', email, password: 'x', role } });

test('an admin creates a user with a hashed password, and the log names the role in Persian', async () => {
  const result: any = await createUser({}, newUser());
  assert.deepEqual(result, { message: 'کاربر با موفقیت ایجاد شد.', success: true });
  const user = await prisma.user.findUniqueOrThrow({ where: { email: 'sara@example.com' } });
  assert.equal(user.name, 'سارا');
  assert.equal(user.role, 'SALES');
  assert.equal(user.phone, '09120000000');
  assert.notEqual(user.password, 'secret123');
  assert.ok(await bcrypt.compare('secret123', user.password));

  const log = await prisma.activityLog.findMany();
  assert.deepEqual(
    log.map((l: { userId: string | null; action: string; details: string }) => [l.userId, l.action, l.details]),
    [['test-user', 'CREATE_USER', 'کاربر سارا با نقش فروشنده ایجاد شد.']],
  );
});

test('a user form with a missing or bad field, or a taken email, creates nothing', async () => {
  const before = await snapshot();
  const refused: Array<Record<string, string>> = [
    { name: '' },
    { email: 'not-an-email' },
    { email: '' },
    { password: '12345' },
    { password: '' },
    { role: 'SUPERUSER' },
    { role: '' },
    { email: 'admin@example.com' },
  ];
  for (const fields of refused) {
    const result: any = await createUser({}, newUser(fields));
    assert.notEqual(result.success, true, JSON.stringify(fields));
    assert.doesNotMatch(result.message, /[A-Za-z]/, `Persian message for ${JSON.stringify(fields)}`);
  }
  assert.deepEqual(await snapshot(), before);
  assert.equal(await prisma.activityLog.count(), 0);
});

test('no role but ADMIN, and no stranger, creates, edits, promotes or deletes a user', async () => {
  const victim = await staff();
  const before = await snapshot();
  for (const role of NON_ADMINS) {
    setTestRole(role);
    assert.notEqual(((await createUser({}, newUser({ role: 'ADMIN' }))) as any).success, true, String(role));
    assert.notEqual(((await updateUser(victim.id, {}, newUser({ email: 'staff@example.com', role: 'ADMIN' }))) as any).success, true);
    assert.equal((await updateUserRole(victim.id, 'ADMIN' as any)).success, false, String(role));
    assert.equal((await deleteUser(victim.id)).success, false, String(role));
    assert.equal((await deleteUser('test-user')).success, false, String(role));
  }
  assert.deepEqual(await snapshot(), before);
  assert.equal(await prisma.activityLog.count(), 0);
});

test('an admin edits a user; a taken email or an unknown user changes nothing', async () => {
  const user = await staff();
  await staff('AUDITOR', 'other@example.com');

  const edited: any = await updateUser(user.id, {}, form({ name: 'Renamed', email: 'renamed@example.com', role: 'ACCOUNTANT', phone: '0912' }));
  assert.equal(edited.success, true, edited.message);
  const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.deepEqual([after.name, after.email, after.role, after.phone, after.password], ['Renamed', 'renamed@example.com', 'ACCOUNTANT', '0912', 'x']);

  const before = await snapshot();
  assert.match(((await updateUser(user.id, {}, form({ name: 'X', email: 'other@example.com', role: 'SALES', phone: '' }))) as any).message, /کاربر دیگری/);
  assert.equal(((await updateUser('no-such-user', {}, form({ name: 'X', email: 'x@example.com', role: 'SALES', phone: '' }))) as any).message, 'خطا در ویرایش کاربر.');
  assert.notEqual(((await updateUser(user.id, {}, form({ name: 'X', email: 'x@example.com', role: 'ROOT', phone: '' }))) as any).success, true);
  assert.deepEqual(await snapshot(), before);
});

test('a role change is written, logged in Persian, and refused for an unknown role or user', async () => {
  const user = await staff();
  assert.deepEqual(await updateUserRole(user.id, 'AUDITOR' as any), { success: true, message: 'نقش کاربر تغییر یافت.' });
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role, 'AUDITOR');
  const log = await prisma.activityLog.findFirstOrThrow({ where: { action: 'UPDATE_ROLE' } });
  assert.equal(log.details, 'نقش کاربر Staff به حسابرس تغییر یافت.');

  assert.equal((await updateUserRole(user.id, 'ROOT' as any)).success, false);
  assert.equal((await updateUserRole('no-such-user', 'SALES' as any)).success, false);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role, 'AUDITOR');
});

test('the last admin cannot lose the ADMIN role, by the role menu or the edit form', async () => {
  // test-user is the only admin.
  assert.deepEqual(await updateUserRole('test-user', 'SALES' as any), { success: false, message: LAST_ADMIN });
  const form1: any = await updateUser('test-user', {}, form({ name: 'مدیر', email: 'admin@example.com', role: 'ACCOUNTANT', phone: '' }));
  assert.equal(form1.message, LAST_ADMIN);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: 'test-user' } })).role, 'ADMIN');
  // Editing the only admin's other fields still works.
  assert.equal(((await updateUser('test-user', {}, form({ name: 'مدیر ارشد', email: 'admin@example.com', role: 'ADMIN', phone: '' }))) as any).success, true);

  // With a second admin, either may step down.
  const second = await staff('ADMIN', 'second@example.com');
  assert.equal((await updateUserRole('test-user', 'SALES' as any)).success, true);
  assert.deepEqual(await updateUserRole(second.id, 'SALES' as any), { success: false, message: LAST_ADMIN });
  assert.equal(await prisma.user.count({ where: { role: 'ADMIN' } }), 1);
});

test('an admin deletes another user by name in the log; their tasks and log rows stay, unassigned', async () => {
  const user = await staff();
  const project = await prisma.project.create({ data: { name: 'P' } });
  const task = await prisma.task.create({ data: { title: 'T', projectId: project.id, assignedTo: user.id } });
  await prisma.activityLog.create({ data: { userId: user.id, action: 'X', details: 'y' } });

  assert.deepEqual(await deleteUser(user.id), { success: true, message: 'کاربر حذف شد.' });
  assert.equal(await prisma.user.count({ where: { id: user.id } }), 0);
  assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).assignedTo, null);
  assert.equal(await prisma.activityLog.count({ where: { action: 'X', userId: null } }), 1);
  const log = await prisma.activityLog.findFirstOrThrow({ where: { action: 'DELETE_USER' } });
  assert.equal(log.details, 'کاربر Staff (staff@example.com) حذف شد.');

  assert.deepEqual(await deleteUser('test-user'), { success: false, message: 'شما نمی‌توانید حساب خود را حذف کنید.' });
  assert.equal((await deleteUser('no-such-user')).success, false);
  assert.equal(await prisma.user.count({ where: { id: 'test-user' } }), 1);
});

test('a signed-in user edits only their own profile, never their role', async () => {
  const other = await staff();
  await prisma.user.update({ where: { id: 'test-user' }, data: { role: 'SALES' } });
  setTestRole('SALES');
  const result: any = await updateProfile({}, form({ name: 'نام تازه', email: 'me@example.com', phone: '0935', role: 'ADMIN' }));
  assert.equal(result.success, true, result.message);
  const me = await prisma.user.findUniqueOrThrow({ where: { id: 'test-user' } });
  assert.deepEqual([me.name, me.email, me.phone, me.role], ['نام تازه', 'me@example.com', '0935', 'SALES']);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).name, 'Staff');

  assert.match(((await updateProfile({}, form({ name: 'x', email: 'staff@example.com', phone: '' }))) as any).message, /کاربر دیگری/);
  assert.notEqual(((await updateProfile({}, form({ name: '', email: 'me@example.com', phone: '' }))) as any).success, true);
  setTestRole(null);
  assert.notEqual(((await updateProfile({}, form({ name: 'x', email: 'x@example.com', phone: '' }))) as any).success, true);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: 'test-user' } })).email, 'me@example.com');
});

test('changing one\'s own password needs the current one; the new one works and the old one stops', async () => {
  setTestRole('WAREHOUSE');
  const change = (currentPassword: string, newPassword: string, confirmPassword = newPassword) =>
    changePassword({}, form({ currentPassword, newPassword, confirmPassword })) as Promise<any>;
  const hash = async () => (await prisma.user.findUniqueOrThrow({ where: { id: 'test-user' } })).password;
  const before = await hash();

  assert.equal((await change('wrong-pass', 'new-pass-1')).message, 'رمز عبور فعلی اشتباه است.');
  assert.notEqual((await change('admin-pass-1', 'new-pass-1', 'new-pass-2')).success, true);
  assert.notEqual((await change('admin-pass-1', '12345')).success, true);
  assert.equal(await hash(), before);

  assert.equal((await change('admin-pass-1', 'new-pass-1')).success, true);
  assert.ok(await bcrypt.compare('new-pass-1', await hash()));
  assert.equal(await bcrypt.compare('admin-pass-1', await hash()), false);
  assert.equal(await prisma.activityLog.count({ where: { userId: 'test-user', action: 'CHANGE_PASSWORD' } }), 1);

  setTestRole(null);
  assert.notEqual((await change('new-pass-1', 'stranger-1')).success, true);
});

test('the user list never carries a password hash', async () => {
  await staff();
  for (const role of ROLES) {
    setTestRole(role);
    const users = await getUsers();
    assert.equal(users.length, 2);
    assert.equal(JSON.stringify(users).includes('password'), false, role);
  }
});

test('the admin user list shows a refused role change or delete instead of failing silently', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/admin/user-list.tsx'), 'utf8');
  assert.match(source, /const result = await updateUserRole\(userId, newRole\);\s*if \(!result\.success\) toast\.error\(result\.message\);/);
  assert.match(source, /const result = await deleteUser\(userId\);\s*if \(!result\.success\) toast\.error\(result\.message\);/);
});
