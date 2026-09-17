import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { AccessDenied, ACCESS_DENIED_MESSAGE } from '@/lib/access';
import { getDashboardFinancials, getDashboardSales, getLowStockItems, getUserTasks } from '@/actions/dashboard';
import DashboardPage from '../../src/app/dashboard/page';
import { FinancialCards } from '@/components/dashboard/financial-cards';
import { SalesChart } from '@/components/dashboard/sales-chart';
import { LowStockAlert } from '@/components/dashboard/low-stock-alert';
import { MyTasksWidget } from '@/components/dashboard/my-tasks-widget';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import {
  convertLeadToCustomer,
  createDeal,
  createLead,
  createTicket,
  getCRMDashboardStats,
  getDealById,
  getDeals,
  getLeadById,
  getLeads,
  getTicketById,
  getTickets,
  resolveTicket,
  updateDealStage,
} from '@/actions/crm';
import { globalSearch } from '@/actions/search';
import {
  createProject,
  createTask,
  deleteTask,
  getProjectById,
  getProjects,
  getProjectsForCalendar,
  updateProject,
  updateTaskStatus,
} from '@/actions/project';

// tsx compiles the page's JSX to React.createElement without importing React.
(globalThis as any).React = React;

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const ROLES = ['ADMIN', 'AUDITOR', 'ACCOUNTANT', 'SALES', 'WAREHOUSE', 'PROJECT_MANAGER', 'USER'];
const BALANCE = 77_123_457;
const COST = 3_456_789;
const PRICE = 9_876_543;
const COGS = 7_310_411;

async function rejectsAccess(promise: Promise<unknown>, label: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AccessDenied, label);
    return true;
  });
}

function assertDenied(result: { success?: boolean; message?: string }, label: string) {
  assert.equal(result.success, false, label);
  assert.equal(result.message, ACCESS_DENIED_MESSAGE, label);
}

/** The props of the first element of `type` in a rendered server component tree. */
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

/** A customer with a debt, a sold product low in stock, a bank balance and a COGS row. */
async function seed() {
  const bank = await prisma.account.create({ data: { name: 'Bank', type: 'BANK', currency: 'TOMAN', balance: BALANCE } });
  const warehouse = await prisma.warehouse.create({ data: { name: 'Main' } });
  const product = await prisma.product.create({ data: { name: 'PANJ Blue', sku: 'PANJ-1', costPrice: COST, sellPrice: PRICE } });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: 2 } });
  const customer = await prisma.customer.create({ data: { name: 'PANJ Buyer', phone: '0912' } });
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      totalAmount: PRICE,
      paidAmount: 0,
      paymentStatus: 'UNPAID',
      tags: ['PANJ'],
      items: { create: [{ productId: product.id, warehouseId: warehouse.id, quantity: 1, price: PRICE }] },
    },
  });
  const sale = await prisma.transaction.create({
    data: { type: 'INCOME', amount: 1_111_111, amountInToman: 1_111_111, currency: 'TOMAN', accountId: bank.id, category: 'Sales', description: 'PANJ sale' },
  });
  const cogs = await prisma.transaction.create({
    data: { type: 'EXPENSE', amount: COGS, amountInToman: COGS, currency: 'TOMAN', category: 'COGS', description: 'PANJ COGS' },
  });
  const lead = await prisma.lead.create({ data: { name: 'Lead', expectedValue: 5_000_000 } });
  const deal = await prisma.deal.create({ data: { title: 'Deal', customerId: customer.id, value: 6_543_210 } });
  const ticket = await prisma.supportTicket.create({ data: { customerId: customer.id, subject: 'S', description: 'D' } });
  return { bank, product, customer, order, sale, cogs, lead, deal, ticket };
}

test('dashboard getters: money needs finance.view, low stock needs stock.view', async () => {
  await seed();
  for (const role of ROLES) {
    setTestRole(role);
    for (const [name, call, permitted] of [
      ['getDashboardFinancials', getDashboardFinancials, ['ADMIN', 'AUDITOR', 'ACCOUNTANT']],
      ['getDashboardSales', getDashboardSales, ['ADMIN', 'AUDITOR', 'ACCOUNTANT']],
      ['getLowStockItems', () => getLowStockItems(), ['ADMIN', 'AUDITOR', 'ACCOUNTANT', 'SALES', 'WAREHOUSE']],
    ] as const) {
      if ((permitted as readonly string[]).includes(role)) await call();
      else await rejectsAccess(call(), `${name} / ${role}`);
    }
  }
  setTestRole('ACCOUNTANT');
  assert.equal((await getDashboardFinancials()).totalBalance, BALANCE);
  assert.equal((await getDashboardFinancials()).totalReceivables, PRICE);
  setTestRole('WAREHOUSE');
  assert.deepEqual(Object.keys((await getLowStockItems())[0]).sort(), ['id', 'name', 'sku', 'totalStock', 'warehouses']);
  setTestRole('USER');
  assert.deepEqual(await getUserTasks(), []);
});

test('the dashboard renders for every role and passes only the cards the role may see', async () => {
  await seed();
  for (const role of ROLES) {
    setTestRole(role);
    const page = await DashboardPage();
    const finance = ['ADMIN', 'AUDITOR', 'ACCOUNTANT'].includes(role);
    const stock = !['PROJECT_MANAGER', 'USER'].includes(role);
    assert.equal(!!propsOf(page, FinancialCards), finance, `FinancialCards / ${role}`);
    assert.equal(!!propsOf(page, SalesChart), finance, `SalesChart / ${role}`);
    assert.equal(!!propsOf(page, LowStockAlert), stock, `LowStockAlert / ${role}`);
    assert.ok(propsOf(page, MyTasksWidget), `MyTasksWidget / ${role}`);
    // Everything the page hands to its client components.
    const served = JSON.stringify(
      [FinancialCards, SalesChart, LowStockAlert, MyTasksWidget, RecentActivity].map((type) => propsOf(page, type)),
    );
    assert.equal(served.includes(String(BALANCE)), finance, `balance / ${role}`);
    assert.equal(served.includes(String(PRICE)), finance, `sales / ${role}`);
    assert.equal(served.includes('PANJ-1'), stock, `low stock / ${role}`);
  }
});

test('CRM reads need sales.view; the CRM stats are empty without it', async () => {
  const { lead, deal, ticket } = await seed();
  for (const role of ['WAREHOUSE', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    await rejectsAccess(getLeads(), `getLeads / ${role}`);
    await rejectsAccess(getLeadById(lead.id), `getLeadById / ${role}`);
    await rejectsAccess(getDeals(), `getDeals / ${role}`);
    await rejectsAccess(getDealById(deal.id), `getDealById / ${role}`);
    await rejectsAccess(getTickets(), `getTickets / ${role}`);
    await rejectsAccess(getTicketById(ticket.id), `getTicketById / ${role}`);
    const stats = await getCRMDashboardStats();
    assert.equal(stats.totalCustomers, 0, String(role));
    assert.equal(stats.activeDealsValue, 0, String(role));
    assert.deepEqual(stats.topCustomers, [], String(role));
    assert.deepEqual(stats.recentDeals, [], String(role));
  }
  for (const role of ['SALES', 'AUDITOR', 'ACCOUNTANT']) {
    setTestRole(role);
    assert.equal((await getDeals())[0].value, 6_543_210, role);
    const stats = await getCRMDashboardStats();
    assert.equal(stats.totalCustomers, 1, role);
    assert.equal(stats.activeDealsValue, 6_543_210, role);
    assert.equal((stats.topCustomers[0] as any).totalRevenue, PRICE, role);
  }
});

test('CRM writes refuse AUDITOR and WAREHOUSE and change nothing; SALES succeeds', async () => {
  const { customer, lead, deal, ticket } = await seed();
  const counts = async () => [
    await prisma.lead.count(),
    await prisma.deal.count(),
    await prisma.supportTicket.count(),
    await prisma.customer.count(),
  ];
  const before = await counts();
  for (const role of ['AUDITOR', 'WAREHOUSE', 'USER']) {
    setTestRole(role);
    assertDenied(await createLead(undefined, form({ name: 'L' })), `createLead / ${role}`);
    assertDenied(await createDeal(undefined, form({ title: 'D', customerId: customer.id, value: '1' })), `createDeal / ${role}`);
    assertDenied(
      await createTicket(undefined, form({ customerId: customer.id, subject: 'S', description: 'D' })),
      `createTicket / ${role}`,
    );
    assertDenied(await updateDealStage(deal.id, 'WON'), `updateDealStage / ${role}`);
    assertDenied(await resolveTicket(ticket.id, 'done'), `resolveTicket / ${role}`);
    assertDenied(await convertLeadToCustomer(lead.id), `convertLeadToCustomer / ${role}`);
  }
  assert.deepEqual(await counts(), before);
  assert.equal((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).stage, 'PROSPECT');
  assert.equal((await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } })).status, 'OPEN');

  setTestRole('SALES');
  const created = await createLead(undefined, form({ name: 'L', company: '', phone: '', email: '', source: '', notes: '' }));
  assert.equal(created.success, true, created.message);
  assert.equal((await updateDealStage(deal.id, 'WON')).success, true);
  assert.equal((await prisma.deal.findUniqueOrThrow({ where: { id: deal.id } })).stage, 'WON');
});

test('global search returns only the groups a role may see, with no cost and no withheld amount', async () => {
  const { product, customer, order, sale, cogs } = await seed();
  const search = async (role: string | null) => {
    setTestRole(role);
    return globalSearch('PANJ');
  };
  const ofType = (results: any[], type: string) => results.filter((r) => r.type === type);

  const warehouse = await search('WAREHOUSE');
  assert.deepEqual(warehouse.map((r) => r.type), ['product']);
  assert.equal(warehouse[0].id, product.id);
  assert.equal(warehouse[0].amount, undefined, 'no sell price without sales.view');

  const sales = await search('SALES');
  assert.equal(ofType(sales, 'product')[0].amount, PRICE);
  assert.equal(ofType(sales, 'customer')[0].id, customer.id);
  assert.equal(ofType(sales, 'order')[0].id, order.id);
  assert.equal(ofType(sales, 'transaction').length, 0);

  const accountant = await search('ACCOUNTANT');
  const transactions = new Map(ofType(accountant, 'transaction').map((r) => [r.id, r]));
  assert.equal(transactions.get(sale.id)?.amount, 1_111_111);
  assert.ok(transactions.has(cogs.id), 'the COGS row is still found');
  assert.equal(transactions.get(cogs.id)?.amount, undefined, 'its amount is cost data');

  const auditor = await search('AUDITOR');
  assert.equal(ofType(auditor, 'transaction').find((r) => r.id === cogs.id)?.amount, COGS);

  for (const role of ['WAREHOUSE', 'SALES', 'ACCOUNTANT', 'AUDITOR', 'ADMIN']) {
    assert.equal(JSON.stringify(await search(role)).includes(String(COST)), false, `cost price / ${role}`);
  }
  for (const role of ['USER', 'PROJECT_MANAGER', null]) {
    assert.deepEqual(await search(role), [], String(role));
  }
});

test('projects: any signed-in user reads, projects.manage writes, AUDITOR is refused', async () => {
  const project = await prisma.project.create({ data: { name: 'Launch' } });
  const task = await prisma.task.create({ data: { title: 'T', projectId: project.id } });

  setTestRole(null);
  assert.deepEqual(await getProjects(), []);
  assert.equal(await getProjectById(project.id), undefined);
  assert.deepEqual(await getProjectsForCalendar(), []);

  for (const role of ROLES) {
    setTestRole(role);
    assert.equal((await getProjects()).length, 1, role);
    assert.equal((await getProjectById(project.id))?.tasks.length, 1, role);
  }

  for (const role of ['AUDITOR', null]) {
    setTestRole(role);
    assertDenied(await createProject(undefined, form({ name: 'X', status: 'ACTIVE' })), `createProject / ${role}`);
    assertDenied(await updateProject(project.id, undefined, form({ name: 'X', status: 'ACTIVE' })), `updateProject / ${role}`);
    assertDenied(await createTask(undefined, form({ title: 'X', projectId: project.id })), `createTask / ${role}`);
    assertDenied(await updateTaskStatus(task.id, 'DONE', project.id), `updateTaskStatus / ${role}`);
    assertDenied(await deleteTask(task.id, project.id), `deleteTask / ${role}`);
  }
  assert.equal(await prisma.project.count(), 1);
  assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).name, 'Launch');
  assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status, 'TODO');

  setTestRole('USER');
  const created = await createProject(
    undefined,
    form({ name: 'Mine', status: 'ACTIVE', description: '', startDate: '', endDate: '', budget: '' }),
  );
  assert.equal(created.success, true, created.message);
  assert.equal(await prisma.project.count(), 2);
  assert.equal((await updateTaskStatus(task.id, 'DONE', project.id)).success, true);
  assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status, 'DONE');
});
