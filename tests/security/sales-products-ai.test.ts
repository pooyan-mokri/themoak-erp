import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { agentTools, getSystemContext } from '@/lib/ai-agent';
import { buildSystemPrompt } from '@/lib/ai-system-prompt';
import { deleteConversation, getConversationMessages, getConversations } from '@/actions/ai-assistant';
import { sendMessage } from '@/actions/ai-chat';

const DENIED = 'شما به این بخش دسترسی ندارید.';
const COST = 4_321_000;
const BALANCE = 987_654_321;
// The auth stub signs everyone in as this user id.
const ME = 'test-user';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(async () => {
  setTestRole('ADMIN');
  await prisma.$disconnect();
});

const run = (name: string, params: Record<string, unknown> = {}) =>
  agentTools.find((tool) => tool.name === name)!.execute(params);

async function seedBusiness() {
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const product = await prisma.product.create({ data: { name: 'PANJ - Blue', sku: 'PANJ/BLUE', costPrice: COST, sellPrice: 15_700_000 } });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: 5 } });
  const account = await prisma.account.create({ data: { name: 'صندوق', type: 'CASH', currency: 'TOMAN', balance: BALANCE } });
  await prisma.transaction.createMany({
    data: [
      { type: 'INCOME', amount: 9_000_000, amountInToman: 9_000_000, accountId: account.id, date: new Date() },
      { type: 'EXPENSE', amount: 2_000_000, amountInToman: 2_000_000, accountId: account.id, date: new Date() },
    ],
  });
  return { account };
}

test('AI tools hide cost, sell price and profit from roles without them, and refuse finance tools in Persian', async () => {
  const { account } = await seedBusiness();

  setTestRole('WAREHOUSE');
  const inventory = await run('get_inventory_summary');
  assert.equal(inventory.totalItems, 5);
  assert.equal('totalValue' in inventory, false);
  const [found] = (await run('search_products')).products;
  assert.deepEqual(Object.keys(found).sort(), ['id', 'name', 'sku', 'stock']);
  for (const tool of ['get_sales_summary', 'get_financial_summary', 'get_customer_info']) {
    assert.deepEqual(await run(tool, { customerId: 'x' }), { success: false, error: DENIED }, tool);
  }
  assert.deepEqual(await run('record_expense', { amount: 1, description: 'x', accountId: account.id }), {
    success: false,
    error: DENIED,
  });
  assert.equal(await prisma.transaction.count(), 2);

  setTestRole('SALES');
  const [salesView] = (await run('search_products')).products;
  assert.equal(salesView.sellPrice, 15_700_000);
  assert.equal('costPrice' in salesView, false);
  assert.deepEqual(await run('get_financial_summary'), { success: false, error: DENIED });
  assert.equal((await run('create_customer', { name: 'x' })).success, true);

  setTestRole('ACCOUNTANT');
  const finance = await run('get_financial_summary');
  assert.equal(finance.totalIncome, 9_000_000);
  assert.equal('netProfit' in finance, false);
  assert.equal(JSON.stringify(await run('search_products')).includes(String(COST)), false);

  setTestRole('AUDITOR');
  assert.equal((await run('get_inventory_summary')).totalValue, COST * 5);
  assert.equal((await run('get_financial_summary')).netProfit, 7_000_000);
  assert.deepEqual(await run('create_customer', { name: 'y' }), { success: false, error: DENIED });
  assert.equal(await prisma.customer.count(), 1);
});

test('the system context and prompt carry only the balances and tools the user may use', async () => {
  await seedBusiness();

  setTestRole('SALES');
  const context = await getSystemContext();
  assert.deepEqual(context.accounts, []);
  const names = context.availableTools.map((tool: { name: string }) => tool.name).sort();
  assert.deepEqual(names, ['create_customer', 'get_customer_info', 'get_inventory_summary', 'search_products']);
  const prompt = buildSystemPrompt(context);
  assert.equal(prompt.includes(String(BALANCE)), false);
  assert.equal(prompt.includes('get_financial_summary:'), false);
  assert.equal(prompt.includes('record_expense'), false);

  setTestRole('ADMIN');
  const full = await getSystemContext();
  assert.deepEqual(full.accounts, [{ name: 'صندوق', balance: BALANCE }]);
  assert.equal(full.availableTools.length, agentTools.length);
});

test('conversations: a user lists, reads, writes to and deletes only their own', async () => {
  await prisma.user.createMany({
    data: [
      { id: ME, name: 'Me', email: 'me@example.com', password: 'x' },
      { id: 'other-user', name: 'Other', email: 'other@example.com', password: 'x' },
    ],
  });
  const mine = await prisma.aIConversation.create({ data: { userId: ME, title: 'mine' } });
  const theirs = await prisma.aIConversation.create({
    data: { userId: 'other-user', title: 'theirs', messages: { create: [{ role: 'USER', content: 'secret question' }] } },
  });
  setTestRole('SALES');

  assert.deepEqual((await getConversations()).map((c: { id: string }) => c.id), [mine.id]);
  assert.deepEqual(await getConversationMessages(theirs.id), []);

  const sent = await sendMessage(theirs.id, 'hello');
  assert.equal(sent.success, false);
  assert.equal(await prisma.aIMessage.count({ where: { conversationId: theirs.id } }), 1);

  const removed = await deleteConversation(theirs.id);
  assert.equal(removed.success, false);
  assert.ok(await prisma.aIConversation.findUnique({ where: { id: theirs.id } }));

  // Their own conversation still works (the assistant is off, so nothing reaches a provider).
  assert.equal((await sendMessage(mine.id, 'hello')).message, 'دستیار هوش مصنوعی فعال نیست');
  assert.equal((await deleteConversation(mine.id)).success, true);
  assert.equal(await prisma.aIConversation.findUnique({ where: { id: mine.id } }), null);
});
