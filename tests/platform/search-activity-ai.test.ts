import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { ROLES, can } from '@/lib/permissions';
import { globalSearch } from '@/actions/search';
import { getRecentActivities } from '@/actions/activity';
import { logActivity } from '@/lib/activity-log';
import { agentTools } from '@/lib/ai-agent';
import { sendMessage } from '@/actions/ai-chat';
import { createConversation } from '@/actions/ai-assistant';

console.log = () => {};
console.error = () => {};

const DENIED = 'شما به این بخش دسترسی ندارید.';
const USD_RATE = 100_000;

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const fa = (n: number) => n.toLocaleString('fa-IR', { useGrouping: false });
const ar = (n: number) => n.toLocaleString('ar-EG', { useGrouping: false });

async function seedSearch() {
  const customer = await prisma.customer.create({ data: { name: 'مریم', phone: '09121234567' } });
  const product = await prisma.product.create({ data: { name: 'عینک ۲۰۲۶', sku: 'MOAK-2026', costPrice: 1_000, sellPrice: 5_000 } });
  const order = await prisma.order.create({ data: { customerId: customer.id, totalAmount: 5_000, paidAmount: 5_000 } });
  const usd = await prisma.account.create({ data: { name: 'دلاری', type: 'BANK', currency: 'USD', balance: 10 } });
  const usdIncome = await prisma.transaction.create({
    data: { type: 'INCOME', amount: 10, currency: 'USD', rateSnapshot: USD_RATE, amountInToman: 10 * USD_RATE, accountId: usd.id, description: 'فروش دلاری' },
  });
  const supplier = await prisma.supplier.create({ data: { name: 'تامین‌کننده چینی' } });
  const purchase = await prisma.purchaseOrder.create({ data: { supplierId: supplier.id, totalAmount: 200, totalAmountInToman: 200 * USD_RATE } });
  return { customer, product, order, usdIncome, purchase };
}

// ---------------------------------------------------------------- search

test('an order is found by its number typed in Persian or Arabic digits, and a huge number does not break the search', async () => {
  const { order } = await seedSearch();
  setTestRole('SALES');
  const number = order.number + 1000; // two digits or more
  await prisma.order.update({ where: { id: order.id }, data: { number } });
  for (const typed of [String(number), fa(number), ar(number), ` ${fa(number)} `]) {
    const results = await globalSearch(typed);
    assert.deepEqual(results.filter((r) => r.type === 'order').map((r) => r.id), [order.id], typed);
  }
  for (const typed of ['99999999999', '۹۹۹۹۹۹۹۹۹۹۹', '1e3', '12.5', '-12']) {
    assert.deepEqual((await globalSearch(typed)).filter((r) => r.type === 'order'), [], typed);
  }
});

test('a phone or SKU typed in Persian digits is found', async () => {
  const { customer, product } = await seedSearch();
  setTestRole('SALES');
  assert.deepEqual((await globalSearch('۰۹۱۲۱۲۳')).filter((r) => r.type === 'customer').map((r) => r.id), [customer.id]);
  assert.deepEqual((await globalSearch('MOAK-۲۰۲۶')).filter((r) => r.type === 'product').map((r) => r.id), [product.id]);
  // A name written with Persian digits is still found as written.
  assert.deepEqual((await globalSearch('عینک ۲۰۲۶')).filter((r) => r.type === 'product').map((r) => r.id), [product.id]);
});

test('every search result links to a page that exists', async () => {
  await seedSearch();
  const results = (await Promise.all(['مریم', 'عینک', 'دلاری', 'تامین'].map((q) => globalSearch(q)))).flat();
  assert.deepEqual([...new Set(results.map((r) => r.type))].sort(), ['customer', 'order', 'product', 'purchase', 'transaction']);
  for (const result of results) {
    const route = result.href.replace(/\/[a-z0-9]{20,}$/, '/[id]');
    assert.ok(existsSync(join(process.cwd(), 'src/app', route, 'page.tsx')), `${result.type}: ${result.href}`);
  }
  // The order page, not the print view.
  const order = results.find((r) => r.type === 'order')!;
  assert.equal(order.href, `/dashboard/sales/history/${order.id}`);
});

test('search amounts are toman: a dollar income and a dollar purchase show their toman value, with no currency code', async () => {
  const { usdIncome, purchase } = await seedSearch();
  setTestRole('ACCOUNTANT');
  const results = await globalSearch('دلاری');
  const income = results.find((r) => r.id === usdIncome.id)!;
  assert.equal(income.amount, 10 * USD_RATE);
  assert.equal(income.currency, undefined, 'the page prints "تومان" when no currency is given');

  const po = (await globalSearch('تامین')).find((r) => r.id === purchase.id)!;
  assert.equal(po.amount, 200 * USD_RATE);
  setTestRole('WAREHOUSE');
  assert.equal((await globalSearch('تامین')).find((r) => r.id === purchase.id)!.amount, undefined, 'purchase totals are finance data');
});

test('a query shorter than two characters, or a caller who may see nothing, finds nothing', async () => {
  await seedSearch();
  assert.deepEqual(await globalSearch(''), []);
  assert.deepEqual(await globalSearch(' م '), []);
  for (const role of [null, ...ROLES.filter((r) => !can(r, 'stock.view') && !can(r, 'sales.view') && !can(r, 'finance.view'))]) {
    setTestRole(role);
    assert.deepEqual(await globalSearch('مریم'), [], String(role));
  }
});

// ---------------------------------------------------------------- activity

test('the activity feed is the 20 newest entries, newest first, for an admin only', async () => {
  const user = await prisma.user.create({ data: { name: 'Staff', email: 'staff@example.com', password: 'hash', role: 'USER' } });
  for (let i = 0; i < 25; i++) {
    await prisma.activityLog.create({ data: { userId: i % 2 ? user.id : null, action: `A${i}`, details: `d${i}`, createdAt: new Date(Date.UTC(2026, 8, 1, 0, i)) } });
  }
  const feed = await getRecentActivities();
  assert.deepEqual(feed.map((a: { action: string }) => a.action), Array.from({ length: 20 }, (_, i) => `A${24 - i}`));
  assert.equal(feed[0].user, undefined, 'an entry with no user');
  assert.deepEqual(feed[1].user, { id: user.id, name: 'Staff', email: 'staff@example.com', role: 'USER' });
  for (const role of [null, ...ROLES.filter((r) => r !== 'ADMIN')]) {
    setTestRole(role);
    assert.deepEqual(await getRecentActivities(), [], String(role));
  }
});

test('an activity entry that cannot be written never breaks the action that logs it', async () => {
  await logActivity('no-such-user', 'X', 'y');
  await logActivity(undefined, 'Y', 'z');
  assert.deepEqual((await prisma.activityLog.findMany()).map((a: { action: string }) => a.action), ['Y']);
});

// ---------------------------------------------------------------- AI tools

const run = (name: string, params: Record<string, unknown> = {}) => agentTools.find((tool) => tool.name === name)!.execute(params);

async function seedMoney() {
  const cash = await prisma.account.create({ data: { name: 'صندوق', type: 'CASH', currency: 'TOMAN', balance: 5_000_000 } });
  const usd = await prisma.account.create({ data: { name: 'دلاری', type: 'BANK', currency: 'USD', balance: 50 } });
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: USD_RATE, date: new Date('2026-09-01') } });
  await prisma.transaction.createMany({
    data: [
      { type: 'INCOME', amount: 1_000_000, amountInToman: 1_000_000, currency: 'TOMAN', accountId: cash.id },
      { type: 'INCOME', amount: 20, amountInToman: 20 * USD_RATE, currency: 'USD', rateSnapshot: USD_RATE, accountId: usd.id },
      { type: 'EXPENSE', amount: 300_000, amountInToman: 300_000, currency: 'TOMAN', accountId: cash.id, category: 'Other' },
      { type: 'EXPENSE', amount: 700_000, amountInToman: 700_000, currency: 'TOMAN', accountId: cash.id, category: 'COGS' },
    ],
  });
  return { cash, usd };
}

test('the AI financial summary totals in toman, and leaves cost rows out for a role without cost.view', async () => {
  await seedMoney();
  setTestRole('ADMIN');
  const admin = await run('get_financial_summary');
  assert.equal(admin.totalIncome, 1_000_000 + 20 * USD_RATE);
  assert.equal(admin.totalExpense, 300_000 + 700_000);
  assert.equal(admin.netProfit, 1_000_000 + 20 * USD_RATE - 1_000_000);
  assert.deepEqual(
    admin.accounts.map((a: { name: string; currency: string; balance: number }) => [a.name, a.currency, a.balance]).sort(),
    [['دلاری', 'USD', 50], ['صندوق', 'TOMAN', 5_000_000]],
  );

  setTestRole('ACCOUNTANT');
  const accountant = await run('get_financial_summary');
  assert.equal(accountant.totalExpense, 300_000, 'COGS is cost data');
  assert.equal('netProfit' in accountant, false);
  assert.equal(JSON.stringify(accountant).includes('700000'), false);
});

test('the AI records an expense only for a positive amount the account holds, in the account currency', async () => {
  const { cash, usd } = await seedMoney();
  const before = { rows: await prisma.transaction.count(), cash: 5_000_000, usd: 50 };
  const refused: Array<[Record<string, unknown>, string]> = [
    [{ amount: 0, description: 'x', accountId: cash.id }, 'مبلغ باید بیشتر از صفر باشد'],
    [{ amount: -500_000, description: 'x', accountId: cash.id }, 'مبلغ باید بیشتر از صفر باشد'],
    [{ amount: '500000', description: 'x', accountId: cash.id }, 'مبلغ باید بیشتر از صفر باشد'],
    [{ amount: Number.NaN, description: 'x', accountId: cash.id }, 'مبلغ باید بیشتر از صفر باشد'],
    [{ amount: Number.POSITIVE_INFINITY, description: 'x', accountId: cash.id }, 'مبلغ باید بیشتر از صفر باشد'],
    [{ amount: 5_000_001, description: 'x', accountId: cash.id }, 'موجودی حساب «صندوق» کافی نیست.'],
    [{ amount: 50 * USD_RATE + 1, description: 'x', accountId: usd.id }, 'موجودی حساب «دلاری» کافی نیست.'],
    [{ amount: 1_000, description: 'x', accountId: 'no-such-account' }, 'حساب یافت نشد'],
  ];
  for (const [params, error] of refused) {
    assert.deepEqual(await run('record_expense', params), { success: false, error }, JSON.stringify(params));
  }
  assert.equal(await prisma.transaction.count(), before.rows);

  const toman = await run('record_expense', { amount: 250_000, description: 'کاغذ', accountId: cash.id });
  assert.equal(toman.success, true);
  const dollars = await run('record_expense', { amount: 10 * USD_RATE, description: 'دامنه', accountId: usd.id, category: 'Other' });
  assert.equal(dollars.success, true);
  assert.equal(Number((await prisma.account.findUniqueOrThrow({ where: { id: cash.id } })).balance), 4_750_000);
  assert.equal(Number((await prisma.account.findUniqueOrThrow({ where: { id: usd.id } })).balance), 40);
  const row = await prisma.transaction.findUniqueOrThrow({ where: { id: dollars.transactionId } });
  assert.deepEqual([row.type, Number(row.amount), row.currency, Number(row.amountInToman), Number(row.rateSnapshot)], ['EXPENSE', 10, 'USD', 10 * USD_RATE, USD_RATE]);

  setTestRole('SALES');
  assert.deepEqual(await run('record_expense', { amount: 1_000, description: 'x', accountId: cash.id }), { success: false, error: DENIED });
});

// ---------------------------------------------------------------- the chat, with a stubbed provider

type Call = { url: string; body: any };

/** Stands in for the AI provider's API: no test reaches a real one. */
function stubProvider(replies: string[]) {
  const calls: Call[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (!url.startsWith('https://api.openai.com/')) throw new Error(`unexpected fetch ${url}`);
    calls.push({ url, body: JSON.parse(init.body) });
    const content = replies.shift() ?? 'عنوان';
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = realFetch) };
}

async function chatAs(role: string) {
  await prisma.user.create({ data: { id: 'test-user', name: 'Me', email: 'me@example.com', password: 'x' } });
  await prisma.aISettings.create({ data: { provider: 'OPENAI', apiKey: 'sk-test', model: 'gpt-4', enabled: true, maxTokens: 5000, temperature: 0.2 } });
  setTestRole(role);
  const created: any = await createConversation('مکالمه جدید');
  return created.conversation.id as string;
}

test('a chat message is answered through the provider with only the caller\'s tools, and a refused tool leaks nothing', async () => {
  await seedMoney();
  const conversationId = await chatAs('SALES');
  const provider = stubProvider(['[TOOL:get_financial_summary] {"days": 30} [/TOOL]', 'به این اطلاعات دسترسی ندارید.', 'عنوان کوتاه']);
  try {
    const result: any = await sendMessage(conversationId, 'موجودی حساب‌ها چقدر است؟');
    assert.equal(result.success, true, result.message);
    assert.equal(result.message.content, 'به این اطلاعات دسترسی ندارید.');
    assert.deepEqual(result.actions, [{ tool: 'get_financial_summary', result: { success: false, error: DENIED } }]);

    const sentToProvider = JSON.stringify(provider.calls.map((c) => c.body));
    assert.equal(sentToProvider.includes('5000000'), false, 'no balance reaches the provider');
    assert.equal(provider.calls[0].body.messages[0].content.includes('record_expense'), false, 'the prompt lists only the caller\'s tools');
    assert.equal(provider.calls[0].body.max_tokens, 1000, 'capped at 1000');
    assert.equal(provider.calls[0].body.temperature, 0.2);

    const messages = await prisma.aIMessage.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(messages.map((m: { role: string }) => m.role), ['USER', 'ASSISTANT']);
    assert.equal(await prisma.aIAction.count(), 1);
    assert.equal((await prisma.aIConversation.findUniqueOrThrow({ where: { id: conversationId } })).title, 'عنوان کوتاه');
    assert.equal(await prisma.transaction.count(), 4, 'nothing booked');
  } finally {
    provider.restore();
  }
});

test('a tool call the caller may make runs once and its result goes back to the provider', async () => {
  const { cash } = await seedMoney();
  const conversationId = await chatAs('ACCOUNTANT');
  const provider = stubProvider([`[TOOL:record_expense] {"amount": 100000, "description": "چای", "accountId": "${cash.id}"} [/TOOL]`, 'ثبت شد.']);
  try {
    const result: any = await sendMessage(conversationId, 'هزینه چای ۱۰۰ هزار تومان از صندوق');
    assert.equal(result.success, true, result.message);
    assert.equal(result.actions[0].result.success, true);
    assert.equal(Number((await prisma.account.findUniqueOrThrow({ where: { id: cash.id } })).balance), 4_900_000);
    assert.ok(JSON.stringify(provider.calls[1].body.messages).includes(result.actions[0].result.transactionId));
  } finally {
    provider.restore();
  }
});

test('a provider failure saves no answer and says so; a bad tool call is recorded as failed', async () => {
  const conversationId = await chatAs('ADMIN');
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'Incorrect API key' } }), { status: 401 })) as typeof fetch;
  try {
    const failed: any = await sendMessage(conversationId, 'سلام');
    assert.equal(failed.success, false);
    assert.match(failed.message, /^خطای OpenAI API/);
    assert.equal(await prisma.aIMessage.count({ where: { role: 'ASSISTANT' } }), 0);
  } finally {
    globalThis.fetch = realFetch;
  }

  const provider = stubProvider(['[TOOL:record_expense] {not json} [/TOOL]', 'باشه']);
  try {
    const result: any = await sendMessage(conversationId, 'ثبت کن');
    assert.equal(result.success, true);
    assert.deepEqual(result.actions, []);
    const action = await prisma.aIAction.findFirstOrThrow();
    assert.equal(action.success, false);
    assert.equal(await prisma.transaction.count(), 0);
  } finally {
    provider.restore();
  }
});
