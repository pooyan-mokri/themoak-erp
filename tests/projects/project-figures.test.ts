import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getMyTasks, getProjectFigures } from '@/actions/project';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const DAY = 86_400_000;

/** A project with three tasks (one done, one past due, one mine) and two expenses booked against it. */
async function seed() {
  const me = await prisma.user.create({ data: { id: 'test-user', name: 'سارا', email: 'sara@example.com', password: 'x' } });
  const other = await prisma.user.create({ data: { name: 'رضا', email: 'reza@example.com', password: 'x' } });
  const project = await prisma.project.create({ data: { name: 'فصل بهار', budget: 10_000_000 } });
  await prisma.task.createMany({
    data: [
      { title: 'طراحی', projectId: project.id, status: 'DONE', assignedTo: me.id },
      { title: 'عکاسی', projectId: project.id, status: 'IN_PROGRESS', dueDate: new Date(Date.now() - 3 * DAY), assignedTo: other.id },
      { title: 'چاپ', projectId: project.id, status: 'TODO', dueDate: new Date(Date.now() + 5 * DAY), assignedTo: me.id },
    ],
  });
  const bank = await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  await prisma.transaction.createMany({
    data: [
      { type: 'EXPENSE', amount: 2_000_000, amountInToman: 2_000_000, accountId: bank.id, projectId: project.id },
      { type: 'EXPENSE', amount: 10, amountInToman: 1_000_000, currency: 'USD', accountId: bank.id, projectId: project.id },
      { type: 'INCOME', amount: 5_000_000, amountInToman: 5_000_000, accountId: bank.id },
    ],
  });
  return { project };
}

test('a project counts its tasks, done and overdue; with finance.view also what its expenses spent in Toman', async () => {
  const { project } = await seed();
  for (const role of ['ADMIN', 'ACCOUNTANT', 'AUDITOR']) {
    setTestRole(role);
    assert.deepEqual((await getProjectFigures())[project.id], { tasks: 3, done: 1, overdue: 1, spent: 3_000_000 }, role);
  }
  for (const role of ['SALES', 'WAREHOUSE', 'USER', 'PROJECT_MANAGER']) {
    setTestRole(role);
    assert.deepEqual((await getProjectFigures())[project.id], { tasks: 3, done: 1, overdue: 1 }, `${role} sees no money`);
  }
  setTestRole(null);
  assert.deepEqual(await getProjectFigures(), {});
});

test('a task due today in Tehran is not overdue yet; one due yesterday is', async () => {
  const project = await prisma.project.create({ data: { name: 'پاییز' } });
  // A due day picked in Tehran is stored at its Tehran midnight (20:30 UTC the day before).
  const tehranMidnight = (daysFromToday: number) => {
    const day = new Date(Date.now() + 3.5 * 3_600_000 + daysFromToday * DAY).toISOString().slice(0, 10);
    return new Date(`${day}T00:00:00.000+03:30`);
  };
  await prisma.task.createMany({
    data: [
      { title: 'امروز', projectId: project.id, status: 'TODO', dueDate: tehranMidnight(0) },
      { title: 'دیروز', projectId: project.id, status: 'TODO', dueDate: tehranMidnight(-1) },
    ],
  });
  assert.equal((await getProjectFigures())[project.id].overdue, 1);
});

test('my tasks are the open ones assigned to me, soonest due first, with their project', async () => {
  const { project } = await seed();
  setTestRole('USER');
  const mine = await getMyTasks();
  assert.deepEqual(
    mine.map((t: any) => [t.title, t.status, t.project.name]),
    [['چاپ', 'TODO', 'فصل بهار']],
  );
  assert.equal(mine[0].project.id, project.id);
  setTestRole(null);
  assert.deepEqual(await getMyTasks(), []);
});
