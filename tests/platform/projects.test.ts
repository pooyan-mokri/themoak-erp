import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { ROLES, can } from '@/lib/permissions';
import { assigneeName } from '@/lib/task-assignee';
import {
  createProject,
  createTask,
  deleteTask,
  getProjectById,
  getProjects,
  getProjectsForCalendar,
  updateProject,
  updateTask,
  updateTaskStatus,
} from '@/actions/project';

// The actions log the database errors these tests provoke on purpose.
console.log = () => {};
console.error = () => {};

const DENIED = 'شما به این بخش دسترسی ندارید.';
const ASSIGNEE_UNAVAILABLE = 'کاربر انتخاب‌شده وجود ندارد یا غیرفعال است؛ کاربر دیگری را انتخاب کنید.';
const MANAGERS = ROLES.filter((role) => can(role, 'projects.manage'));
const NOT_MANAGERS = [null, ...ROLES.filter((role) => !can(role, 'projects.manage'))];

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const projectForm = (fields: Record<string, string> = {}) =>
  form({ name: 'فروشگاه جدید', description: 'افتتاح شعبه', status: 'ACTIVE', startDate: '2026-09-01', endDate: '2026-12-01', budget: '250000000', ...fields });

async function seed() {
  const ali = await prisma.user.create({ data: { id: 'user-ali', name: 'علی رضایی', email: 'ali@example.com', password: 'secret-hash', role: 'SALES' } });
  const sara = await prisma.user.create({ data: { id: 'user-sara', name: 'سارا', email: 'sara@example.com', password: 'secret-hash', role: 'USER' } });
  const project = await prisma.project.create({ data: { name: 'P1', status: 'ACTIVE' } });
  return { ali, sara, project };
}

const taskForm = (projectId: string, fields: Record<string, string> = {}) =>
  form({
    title: 'طراحی ویترین',
    description: 'قفسه‌ها',
    status: 'TODO',
    priority: 'HIGH',
    // What the Jalali date picker sends: an ISO instant (Tehran midnight).
    startDate: '2026-09-30T20:30:00.000Z',
    dueDate: '2026-10-05T20:30:00.000Z',
    projectId,
    assignedTo: 'user-ali',
    ...fields,
  });

const snapshot = async () => ({
  projects: await prisma.project.findMany({ orderBy: { id: 'asc' } }),
  tasks: await prisma.task.findMany({ orderBy: { id: 'asc' } }),
});

test('a project is created with its fields; a missing status is ACTIVE', async () => {
  const result = await createProject({}, projectForm({ status: '' }));
  assert.equal(result.success, true, result.message);
  const project = await prisma.project.findFirstOrThrow();
  assert.equal(project.name, 'فروشگاه جدید');
  assert.equal(project.description, 'افتتاح شعبه');
  assert.equal(project.status, 'ACTIVE');
  assert.equal(Number(project.budget), 250_000_000);
  assert.equal(project.startDate?.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(project.endDate?.toISOString(), '2026-12-01T00:00:00.000Z');

  // Optional dates may be left out.
  assert.equal((await createProject({}, projectForm({ name: 'بدون تاریخ', startDate: '', endDate: '' }))).success, true);
  const open = await prisma.project.findFirstOrThrow({ where: { name: 'بدون تاریخ' } });
  assert.equal(open.startDate, null);
  assert.equal(open.endDate, null);
});

test('a project form with a bad field, a negative budget or an end before its start is refused and nothing is saved', async () => {
  const existing = await prisma.project.create({ data: { name: 'Keep', budget: 5, startDate: new Date('2026-01-01') } });
  const before = await snapshot();
  const bad: Array<Record<string, string>> = [
    { name: '' },
    { status: 'DELETED' },
    { budget: '-1' },
    { budget: 'abc' },
    { startDate: '2026-12-02', endDate: '2026-12-01' },
  ];
  for (const fields of bad) {
    const created = await createProject({}, projectForm(fields));
    assert.notEqual(created.success, true, `create ${JSON.stringify(fields)}`);
    assert.doesNotMatch(created.message ?? '', /[A-Za-z]/);
    const updated = await updateProject(existing.id, {}, projectForm(fields));
    assert.notEqual(updated.success, true, `update ${JSON.stringify(fields)}`);
  }
  assert.equal((await createProject({}, projectForm({ startDate: '2026-12-02', endDate: '2026-12-01' }))).message, 'تاریخ پایان پروژه نمی‌تواند قبل از تاریخ شروع باشد.');
  assert.deepEqual(await snapshot(), before);
});

test('a project is updated; its dates stay when the form leaves them empty', async () => {
  const { project } = await seed();
  await prisma.project.update({ where: { id: project.id }, data: { startDate: new Date('2026-01-01'), budget: 10 } });
  const result = await updateProject(project.id, {}, projectForm({ name: 'P1 renamed', status: 'ON_HOLD', startDate: '', endDate: '', budget: '99' }));
  assert.equal(result.success, true, result.message);
  const after = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
  assert.deepEqual([after.name, after.status, Number(after.budget)], ['P1 renamed', 'ON_HOLD', 99]);
  assert.equal(after.startDate?.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal((await updateProject('no-such-project', {}, projectForm())).message, 'خطا در بروزرسانی پروژه.');
});

test('every role that manages projects creates and edits them and their tasks; AUDITOR and strangers change nothing', async () => {
  const { project } = await seed();
  const task = await prisma.task.create({ data: { title: 'T', projectId: project.id } });

  for (const role of NOT_MANAGERS) {
    setTestRole(role);
    const before = await snapshot();
    assert.equal((await createProject({}, projectForm())).message, DENIED, String(role));
    assert.equal((await updateProject(project.id, {}, projectForm())).message, DENIED, String(role));
    assert.equal((await createTask({}, taskForm(project.id))).message, DENIED, String(role));
    assert.equal((await updateTask(task.id, {}, taskForm(project.id, { title: 'X' }))).message, DENIED, String(role));
    assert.equal(((await updateTaskStatus(task.id, 'DONE', project.id)) as any).message, DENIED, String(role));
    assert.equal(((await deleteTask(task.id, project.id)) as any).message, DENIED, String(role));
    assert.deepEqual(await snapshot(), before, String(role));
  }

  assert.deepEqual([...MANAGERS].sort(), ['ACCOUNTANT', 'ADMIN', 'PROJECT_MANAGER', 'SALES', 'USER', 'WAREHOUSE']);
  for (const role of MANAGERS) {
    setTestRole(role);
    assert.equal((await createProject({}, projectForm({ name: `by ${role}` }))).success, true, role);
    assert.equal((await createTask({}, taskForm(project.id, { title: `by ${role}` }))).success, true, role);
    assert.equal(((await updateTaskStatus(task.id, 'IN_PROGRESS', project.id)) as any).success, true, role);
  }
  assert.equal(await prisma.project.count(), 1 + MANAGERS.length);
  assert.equal(await prisma.task.count(), 1 + MANAGERS.length);
});

test('every signed-in role can see projects and their tasks; a stranger sees nothing', async () => {
  const { project } = await seed();
  await prisma.task.create({ data: { title: 'T', projectId: project.id, assignedTo: 'user-ali', dueDate: new Date('2026-10-01') } });
  for (const role of ROLES) {
    setTestRole(role);
    assert.equal((await getProjects()).length, 1, role);
    assert.equal((await getProjectById(project.id))?.tasks.length, 1, role);
    assert.equal((await getProjectsForCalendar()).length, 1, role);
  }
  setTestRole(null);
  assert.deepEqual(await getProjects(), []);
  assert.equal(await getProjectById(project.id), undefined);
  assert.deepEqual(await getProjectsForCalendar(), []);
});

test('a task is created with its assignee, priority and the picker dates; a start after the due date is refused', async () => {
  const { project } = await seed();
  const result = await createTask({}, taskForm(project.id));
  assert.equal(result.success, true, result.message);
  const task = await prisma.task.findFirstOrThrow();
  assert.deepEqual(
    [task.title, task.description, task.status, task.priority, task.assignedTo, task.projectId],
    ['طراحی ویترین', 'قفسه‌ها', 'TODO', 'HIGH', 'user-ali', project.id],
  );
  assert.equal(task.startDate?.toISOString(), '2026-09-30T20:30:00.000Z');
  assert.equal(task.dueDate?.toISOString(), '2026-10-05T20:30:00.000Z');

  // Defaults, and no assignee.
  assert.equal((await createTask({}, taskForm(project.id, { status: '', priority: '', assignedTo: '', startDate: '', dueDate: '' }))).success, true);
  const plain = await prisma.task.findFirstOrThrow({ where: { NOT: { id: task.id } } });
  assert.deepEqual([plain.status, plain.priority, plain.assignedTo, plain.dueDate], ['TODO', 'MEDIUM', null, null]);

  const before = await snapshot();
  const late = await createTask({}, taskForm(project.id, { startDate: '2026-10-06T20:30:00.000Z' }));
  assert.equal(late.message, 'تاریخ شروع باید قبل از تاریخ سررسید باشد.');
  const refusedFields: Array<Record<string, string>> = [{ title: '' }, { projectId: '' }, { status: 'LATER' }, { priority: 'CRITICAL' }, { projectId: 'no-such-project' }, { assignedTo: 'no-such-user' }];
  for (const fields of refusedFields) {
    const refused = await createTask({}, taskForm(project.id, fields));
    assert.notEqual(refused.success, true, JSON.stringify(fields));
    assert.doesNotMatch(refused.message ?? '', /[A-Za-z]/, JSON.stringify(fields));
  }
  assert.deepEqual(await snapshot(), before);
});

test('a task edit saves its fields, can empty the description, and keeps dates the form leaves empty', async () => {
  const { project } = await seed();
  await createTask({}, taskForm(project.id));
  const task = await prisma.task.findFirstOrThrow();

  const result = await updateTask(task.id, {}, taskForm(project.id, { title: 'ویترین نهایی', description: '', status: 'REVIEW', priority: 'URGENT', assignedTo: 'user-sara', startDate: '', dueDate: '' }));
  assert.equal(result.success, true, result.message);
  const after = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  assert.deepEqual(
    [after.title, after.description, after.status, after.priority, after.assignedTo],
    ['ویترین نهایی', '', 'REVIEW', 'URGENT', 'user-sara'],
  );
  assert.equal(after.dueDate?.toISOString(), '2026-10-05T20:30:00.000Z');
  assert.equal(after.startDate?.toISOString(), '2026-09-30T20:30:00.000Z');

  const newDue = await updateTask(task.id, {}, taskForm(project.id, { dueDate: '2026-11-01T20:30:00.000Z', startDate: '' }));
  assert.equal(newDue.success, true);
  assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).dueDate?.toISOString(), '2026-11-01T20:30:00.000Z');
});

test('a task edit that fails says so in Persian, without the database message, and changes nothing', async () => {
  const { project } = await seed();
  await createTask({}, taskForm(project.id));
  const task = await prisma.task.findFirstOrThrow();
  const before = await snapshot();

  const unknownUser = await updateTask(task.id, {}, taskForm(project.id, { assignedTo: 'no-such-user' }));
  assert.deepEqual(unknownUser, { success: false, message: ASSIGNEE_UNAVAILABLE, errors: undefined });
  const unknownTask = await updateTask('no-such-task', {}, taskForm(project.id));
  assert.equal(unknownTask.message, 'خطا در بروزرسانی وظیفه.');
  const late = await updateTask(task.id, {}, taskForm(project.id, { startDate: '2026-10-06T20:30:00.000Z' }));
  assert.equal(late.message, 'تاریخ شروع باید قبل از تاریخ سررسید باشد.');
  assert.notEqual((await updateTask(task.id, {}, taskForm(project.id, { title: '' }))).success, true);
  assert.deepEqual(await snapshot(), before);
});

test('a task moves between the board columns; an unknown status or task changes nothing', async () => {
  const { project } = await seed();
  const task = await prisma.task.create({ data: { title: 'T', projectId: project.id } });
  for (const status of ['IN_PROGRESS', 'REVIEW', 'DONE', 'TODO']) {
    assert.deepEqual(await updateTaskStatus(task.id, status, project.id), { success: true });
    assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status, status);
  }
  for (const status of ['HACKED', 'COMPLETED', 'done', '']) {
    assert.deepEqual(await updateTaskStatus(task.id, status, project.id), { success: false, message: 'وضعیت نامعتبر است.' });
  }
  assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status, 'TODO');
  assert.deepEqual(await updateTaskStatus('no-such-task', 'DONE', project.id), { success: false, message: 'خطا در بروزرسانی وضعیت.' });
});

test('a task is deleted; an unknown one is reported', async () => {
  const { project } = await seed();
  const task = await prisma.task.create({ data: { title: 'T', projectId: project.id } });
  assert.deepEqual(await deleteTask(task.id, project.id), { success: true });
  assert.equal(await prisma.task.count(), 0);
  assert.deepEqual(await deleteTask(task.id, project.id), { success: false, message: 'خطا در حذف وظیفه.' });
});

test('project lists carry task counts and budgets as numbers', async () => {
  const { project } = await seed();
  await prisma.project.update({ where: { id: project.id }, data: { budget: 1_500_000 } });
  await prisma.task.createMany({ data: [{ title: 'a', projectId: project.id }, { title: 'b', projectId: project.id }] });
  await prisma.project.create({ data: { name: 'P2' } });
  const list = await getProjects();
  const p1 = list.find((p: { id: string }) => p.id === project.id)!;
  assert.equal(p1._count.tasks, 2);
  assert.equal(p1.budget, 1_500_000);
  assert.equal(list.find((p: { name: string }) => p.name === 'P2')!.budget, undefined);
});

test('a task shows its assignee by name on the board and in the calendar, never by user id', async () => {
  const { ali, project } = await seed();
  await prisma.task.create({ data: { title: 'assigned', projectId: project.id, assignedTo: ali.id, dueDate: new Date('2026-10-01T20:30:00Z') } });
  await prisma.task.create({ data: { title: 'open', projectId: project.id, dueDate: new Date('2026-10-02T20:30:00Z') } });
  await prisma.task.create({ data: { title: 'no due date', projectId: project.id, assignedTo: ali.id } });

  setTestRole('USER');
  const detail = await getProjectById(project.id);
  const assigned = detail!.tasks.find((t: { title: string }) => t.title === 'assigned')!;
  assert.deepEqual(assigned.assignedToUser, { id: ali.id, name: 'علی رضایی' });
  assert.equal(assigneeName(assigned), 'علی رضایی');
  assert.equal(assigneeName(detail!.tasks.find((t: { title: string }) => t.title === 'open')!), undefined);
  assert.equal(JSON.stringify(detail).includes('secret-hash'), false, 'no password hash reaches the page');
  assert.equal(JSON.stringify(detail).includes('ali@example.com'), false, 'nor a staff email');

  // A task on the board after a move has only the id: the board's user list names it.
  assert.equal(assigneeName({ assignedTo: ali.id }, [{ id: ali.id, name: 'علی رضایی' }]), 'علی رضایی');
  assert.equal(assigneeName({ assignedTo: 'gone' }, []), undefined);
  assert.equal(assigneeName({ assignedTo: null }), undefined);

  // The calendar: only tasks with a due date, the assignee as a user and the project named.
  const [calendar] = await getProjectsForCalendar();
  assert.deepEqual(calendar.tasks.map((t: { title: string }) => t.title).sort(), ['assigned', 'open']);
  const due = calendar.tasks.find((t: { title: string }) => t.title === 'assigned');
  assert.deepEqual(due.assignedTo, { id: ali.id, name: 'علی رضایی' });
  assert.deepEqual(due.project, { id: project.id, name: 'P1' });
  assert.equal(JSON.stringify(calendar).includes('secret-hash'), false);
});

test('the task card and task list show the assignee name and a Persian priority, not raw codes', () => {
  for (const file of ['src/components/projects/task-card.tsx', 'src/components/projects/task-list.tsx']) {
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    assert.doesNotMatch(source, /\{task\.assignedTo\}/, file);
    assert.match(source, /assigneeName\(task/, file);
  }
  const card = readFileSync(join(process.cwd(), 'src/components/projects/task-card.tsx'), 'utf8');
  assert.doesNotMatch(card, /\{task\.priority\}/);
  // The design card names the priority through project-labels, whose names are Persian.
  assert.match(card, /taskPriority\(task\.priority\)/);
  const labels = readFileSync(join(process.cwd(), 'src/components/projects/project-labels.ts'), 'utf8');
  for (const [code, name] of [['LOW', 'پایین'], ['MEDIUM', 'متوسط'], ['HIGH', 'بالا'], ['URGENT', 'فوری']]) {
    assert.match(labels, new RegExp(`${code}: \\{ label: '${name}'`), code);
  }
});

test('a project budget is shown to and set by finance.view roles only; others leave it as it is', async () => {
  const { project } = await seed();
  await prisma.project.update({ where: { id: project.id }, data: { budget: 7_000_000 } });

  for (const role of ROLES) {
    setTestRole(role);
    const shown = can(role, 'finance.view') ? 7_000_000 : undefined;
    assert.equal((await getProjects())[0].budget, shown, `list / ${role}`);
    assert.equal((await getProjectById(project.id))!.budget, shown, `detail / ${role}`);
    assert.equal((await getProjectsForCalendar())[0].budget, shown, `calendar / ${role}`);
    if (!shown) {
      for (const served of [await getProjects(), await getProjectById(project.id), await getProjectsForCalendar()]) {
        assert.equal(JSON.stringify(served).includes('7000000'), false, role);
      }
    }
  }

  // Without finance.view the form has no budget field: an edit or a new project sets none.
  for (const role of ['SALES', 'WAREHOUSE', 'PROJECT_MANAGER', 'USER']) {
    setTestRole(role);
    assert.equal((await updateProject(project.id, {}, projectForm({ name: 'P1', budget: '' }))).success, true, role);
    assert.equal((await updateProject(project.id, {}, projectForm({ name: 'P1', budget: '1' }))).success, true, role);
    assert.equal(Number((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).budget), 7_000_000, role);
  }
  setTestRole('SALES');
  assert.equal((await createProject({}, projectForm({ name: 'by sales', budget: '999' }))).success, true);
  assert.equal((await prisma.project.findFirstOrThrow({ where: { name: 'by sales' } })).budget, null);

  setTestRole('ACCOUNTANT');
  assert.equal((await updateProject(project.id, {}, projectForm({ name: 'P1', budget: '8000000' }))).success, true);
  assert.equal(Number((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).budget), 8_000_000);
});

test('the project pages pass the budget only to finance.view roles', () => {
  const list = readFileSync(join(process.cwd(), 'src/app/dashboard/projects/page.tsx'), 'utf8');
  // The design list page reads finance.view with its other figures, and hands it to the form and the list.
  assert.match(list, /\[projects, figures, myTasks, canManage, showBudget\] = await Promise\.all\(\[[^\]]*hasPermission\('finance\.view'\),\s*\]\)/);
  assert.match(list, /<ProjectForm showBudget=\{showBudget\} \/>/);
  assert.match(list, /<ProjectList projects=\{projects\} figures=\{figures\} showBudget=\{showBudget\} \/>/);
  assert.match(readFileSync(join(process.cwd(), 'src/app/dashboard/projects/new/page.tsx'), 'utf8'), /<ProjectForm showBudget=\{showBudget\} \/>/);
  const detail = readFileSync(join(process.cwd(), 'src/app/dashboard/projects/[id]/page.tsx'), 'utf8');
  assert.match(detail, /const showBudget = await hasPermission\('finance\.view'\);/);
  assert.match(detail, /<ProjectForm project=\{project\} showBudget=\{showBudget\}/);
  assert.match(readFileSync(join(process.cwd(), 'src/components/projects/project-form.tsx'), 'utf8'), /\{showBudget && \(/);
  // The design cards show the budget and the spend only with showBudget.
  assert.match(readFileSync(join(process.cwd(), 'src/components/projects/project-list.tsx'), 'utf8'), /\{showBudget && \(\s*<div className="mt-auto grid grid-cols-2 gap-3 border-t pt-3">\s*<div>\s*<p className="text-\[11\.5px\] text-muted-foreground">بودجه/);
});

test('a task is given only to an existing, active user; its current assignee stays through an edit after deactivation', async () => {
  const { ali, sara, project } = await seed();
  await prisma.user.update({ where: { id: sara.id }, data: { isActive: false } });
  const before = await snapshot();

  for (const assignedTo of [sara.id, 'no-such-user']) {
    assert.deepEqual(await createTask({}, taskForm(project.id, { assignedTo })), { success: false, message: ASSIGNEE_UNAVAILABLE, errors: undefined }, assignedTo);
  }
  assert.deepEqual(await snapshot(), before);

  assert.equal((await createTask({}, taskForm(project.id, { assignedTo: ali.id }))).success, true);
  const task = await prisma.task.findFirstOrThrow();
  for (const assignedTo of [sara.id, 'no-such-user']) {
    assert.deepEqual(await updateTask(task.id, {}, taskForm(project.id, { assignedTo, title: 'changed' })), { success: false, message: ASSIGNEE_UNAVAILABLE, errors: undefined }, assignedTo);
  }
  const unchanged = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  assert.deepEqual([unchanged.assignedTo, unchanged.title], [ali.id, 'طراحی ویترین']);

  // Ali is deactivated after being given the task: the task can still be edited, and keeps him.
  await prisma.user.update({ where: { id: ali.id }, data: { isActive: false } });
  assert.equal((await updateTask(task.id, {}, taskForm(project.id, { assignedTo: ali.id, title: 'still Ali' }))).success, true);
  const kept = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
  assert.deepEqual([kept.assignedTo, kept.title], [ali.id, 'still Ali']);
});

test('the report counts active admins only', () => {
  const sql = readFileSync(join(process.cwd(), 'prisma/sql/report-platform-checks.sql'), 'utf8');
  assert.match(sql, /SELECT count\(\*\) AS "activeAdmins" FROM "User" WHERE role = 'ADMIN' AND "isActive";/);
});
