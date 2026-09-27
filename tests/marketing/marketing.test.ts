import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { createMarketingCampaign, createMarketingGift, getMarketingCampaigns, getMarketingGifts, getMarketingStats } from '@/actions/marketing';
import { DUPLICATE_REQUEST_MESSAGE } from '@/lib/request-id';
import { DENIED, NON_SELLERS, SELLERS, assertInvariants, balanceOf, openAccount, quantityOf, sleep, snapshot, stockIn } from '../sales/world';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const COST = 400_000;

beforeEach(async () => {
  beforeQuery.fn = null;
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/** Frames and cases in the shop, an expense account for gifts, a dollar expense account and a campaign with a budget. */
async function world() {
  const store = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: COST, sellPrice: 2_000_000 } });
  const caseItem = await prisma.product.create({ data: { name: 'جلد', sku: 'CASE', costPrice: 50_000, sellPrice: 100_000 } });
  await stockIn(frame.id, store.id, 5);
  await stockIn(caseItem.id, store.id, 10);
  const expense = await openAccount('Marketing Expenses', { type: 'EXPENSE' });
  const usdExpense = await openAccount('هزینه دلاری', { type: 'EXPENSE', currency: 'USD' });
  const campaign = await prisma.marketingCampaign.create({ data: { name: 'یلدا', type: 'EVENT', startDate: new Date('2026-12-01'), budget: 5_000_000, status: 'ACTIVE' } });
  return { store, frame, caseItem, expense, usdExpense, campaign };
}
type World = Awaited<ReturnType<typeof world>>;

const gift = (w: World, items: Array<{ productId: string; quantity: number | string; warehouseId?: string }>, fields: Record<string, string> = {}) =>
  createMarketingGift(
    undefined,
    form({
      items: JSON.stringify(items.map((item) => ({ warehouseId: w.store.id, ...item }))),
      recipientName: 'اینفلوئنسر',
      accountId: w.expense.id,
      reason: 'معرفی در صفحه',
      notes: '',
      date: '2026-12-10T08:00:00.000Z',
      campaignId: w.campaign.id,
      ...fields,
    }),
  );

test('a gift is booked at cost on the expense account, takes the stock with a movement, and adds to its campaign', async () => {
  const w = await world();
  const result = await gift(w, [{ productId: w.frame.id, quantity: 2 }, { productId: w.caseItem.id, quantity: 3 }]);
  assert.deepEqual(result, { message: 'هدیه بازاریابی با موفقیت ثبت شد.', success: true });

  const total = 2 * COST + 3 * 50_000;
  const row = await prisma.transaction.findFirstOrThrow({ where: { category: 'Marketing - Gift' } });
  assert.deepEqual(
    [row.type, Number(row.amount), Number(row.amountInToman), row.accountId, row.date.toISOString()],
    ['EXPENSE', total, total, w.expense.id, '2026-12-10T08:00:00.000Z'],
  );
  assert.match(row.description ?? '', /PANJ \(2 عدد\)، جلد \(3 عدد\) - گیرنده: اینفلوئنسر - دلیل: معرفی در صفحه/);
  assert.equal(await balanceOf(w.expense.id), -total);

  const gifts = await prisma.marketingGift.findMany({ orderBy: { totalCost: 'desc' } });
  assert.deepEqual(
    gifts.map((g: any) => [g.productId, g.quantity, Number(g.costPrice), Number(g.totalCost), g.campaignId, g.transactionId !== null]),
    [[w.frame.id, 2, COST, 2 * COST, w.campaign.id, true], [w.caseItem.id, 3, 50_000, 150_000, w.campaign.id, false]],
  );
  assert.equal(Number((await prisma.marketingCampaign.findUniqueOrThrow({ where: { id: w.campaign.id } })).spentAmount), total);
  assert.deepEqual([await quantityOf(w.frame.id, w.store.id), await quantityOf(w.caseItem.id, w.store.id)], [3, 7]);
  const moves = await prisma.inventoryMovement.findMany({ where: { type: 'ADJUSTMENT' } });
  assert.deepEqual(moves.map((m: any) => [m.productId, m.fromWarehouseId, m.quantity]).sort(), [[w.caseItem.id, w.store.id, 3], [w.frame.id, w.store.id, 2]].sort());
  await assertInvariants();
});

test('a gift on a dollar expense account moves it in dollars at the latest rate; without a rate it is refused', async () => {
  const w = await world();
  const before = await snapshot();
  const refused = await gift(w, [{ productId: w.frame.id, quantity: 1 }], { accountId: w.usdExpense.id });
  assert.equal(refused.message, 'نرخ تبدیل برای ارز USD یافت نشد. لطفا ابتدا نرخ امروز را وارد کنید.');
  assert.deepEqual(await snapshot(), before);
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 100_000, date: new Date('2026-12-01') } });
  assert.equal((await gift(w, [{ productId: w.frame.id, quantity: 1 }], { accountId: w.usdExpense.id })).success, true);
  const row = await prisma.transaction.findFirstOrThrow({ where: { category: 'Marketing - Gift' } });
  assert.deepEqual([Number(row.amount), row.currency, Number(row.amountInToman), Number(row.rateSnapshot)], [4, 'USD', COST, 100_000]);
  assert.equal(await balanceOf(w.usdExpense.id), -4);
  await assertInvariants();
});

test('a gift of more than the warehouse holds is refused whole, also over two lines of the same frame', async () => {
  const w = await world();
  const before = await snapshot();
  assert.match((await gift(w, [{ productId: w.caseItem.id, quantity: 1 }, { productId: w.frame.id, quantity: 6 }])).message ?? '', /موجودی کافی برای محصول "PANJ"/);
  // 3 + 3 of 5: each line alone fits.
  assert.match((await gift(w, [{ productId: w.frame.id, quantity: 3 }, { productId: w.frame.id, quantity: 3 }])).message ?? '', /موجودی کافی برای محصول "PANJ"/);
  assert.deepEqual(await snapshot(), before);
  assert.equal(await quantityOf(w.frame.id, w.store.id), 5);
});

test('a gift that is not whole units, names no product, a bank account or an unknown campaign is refused in Persian', async () => {
  const w = await world();
  const bank = await openAccount('بانک', { opening: 1_000_000 });
  const before = await snapshot();
  const invalid = 'لطفا فیلدهای الزامی را پر کنید.';
  assert.equal((await gift(w, [{ productId: w.frame.id, quantity: 1.5 }])).message, invalid);
  assert.equal((await gift(w, [{ productId: w.frame.id, quantity: 0 }])).message, invalid);
  assert.equal((await gift(w, [])).message, invalid);
  assert.equal((await gift(w, [{ productId: w.frame.id, quantity: 1 }], { recipientName: '' })).message, invalid);
  assert.equal((await gift(w, [{ productId: w.frame.id, quantity: 1 }], { items: 'not json' })).message, invalid);
  assert.equal((await gift(w, [{ productId: 'no-such-product', quantity: 1 }])).message, 'محصول با شناسه no-such-product یافت نشد.');
  assert.equal((await gift(w, [{ productId: w.frame.id, quantity: 1 }], { accountId: bank.id })).message, 'هدیه فقط روی حساب هزینه ثبت می‌شود؛ «بانک» حساب هزینه نیست.');
  assert.equal((await gift(w, [{ productId: w.frame.id, quantity: 1 }], { accountId: 'no-such-account' })).message, 'حساب یافت نشد.');
  assert.equal((await gift(w, [{ productId: w.frame.id, quantity: 1 }], { campaignId: 'no-such-campaign' })).message, 'کمپین یافت نشد.');
  for (const role of NON_SELLERS) {
    setTestRole(role);
    assert.equal((await gift(w, [{ productId: w.frame.id, quantity: 1 }])).message, DENIED, String(role));
  }
  assert.deepEqual(await snapshot(), before);
  setTestRole('SALES');
  assert.equal((await gift(w, [{ productId: w.frame.id, quantity: 1 }], { campaignId: '' })).success, true, 'no campaign is fine');
});

test('two gifts of the last frame at the same time: one is booked, stock stays at 0', async () => {
  const w = await world();
  await prisma.inventory.update({ where: { productId_warehouseId: { productId: w.frame.id, warehouseId: w.store.id } }, data: { quantity: 1 } });
  await prisma.inventoryMovement.create({ data: { productId: w.frame.id, fromWarehouseId: w.store.id, quantity: 4, type: 'ADJUSTMENT' } });
  beforeQuery.fn = async (params) => {
    if (params.model === 'MarketingGift' && params.action === 'create') await sleep(150);
  };
  const results = await Promise.all([gift(w, [{ productId: w.frame.id, quantity: 1 }]), gift(w, [{ productId: w.frame.id, quantity: 1 }])]);
  beforeQuery.fn = null;
  assert.deepEqual(results.map((r) => r.success === true).sort(), [false, true]);
  assert.equal(await quantityOf(w.frame.id, w.store.id), 0);
  assert.equal(await prisma.marketingGift.count(), 1);
  await assertInvariants();
});

test('the same gift submitted twice, one after the other or at once, is booked once', async () => {
  const w = await world();
  const once = { requestId: 'gift-request-0001' };
  assert.equal((await gift(w, [{ productId: w.frame.id, quantity: 1 }], once)).success, true);
  const before = await snapshot();
  assert.deepEqual(await gift(w, [{ productId: w.frame.id, quantity: 1 }], once), { message: DUPLICATE_REQUEST_MESSAGE, success: true });
  assert.deepEqual(await snapshot(), before);

  beforeQuery.fn = async (params) => {
    if (params.model === 'MarketingGift' && params.action === 'create') await sleep(150);
  };
  const both = await Promise.all([
    gift(w, [{ productId: w.frame.id, quantity: 1 }], { requestId: 'gift-request-0002' }),
    gift(w, [{ productId: w.frame.id, quantity: 1 }], { requestId: 'gift-request-0002' }),
  ]);
  beforeQuery.fn = null;
  assert.deepEqual(both.map((r) => r.success), [true, true]);
  assert.equal(await prisma.marketingGift.count(), 2);
  assert.equal(await quantityOf(w.frame.id, w.store.id), 3);
  await assertInvariants();
});

test('a campaign is created with its dates and budget; bad dates or a negative budget are refused in Persian', async () => {
  const w = await world();
  const campaign = (fields: Record<string, string>) =>
    createMarketingCampaign(undefined, form({ name: 'نوروز', type: 'SOCIAL_MEDIA', startDate: '2027-03-15T20:30:00.000Z', endDate: '2027-04-01T20:30:00.000Z', budget: '10000000', status: 'PLANNED', description: '', ...fields }));
  assert.deepEqual(await campaign({}), { message: 'کمپین بازاریابی با موفقیت ایجاد شد.', success: true });
  const created = await prisma.marketingCampaign.findFirstOrThrow({ where: { name: 'نوروز' } });
  assert.deepEqual([created.type, created.status, Number(created.budget), Number(created.spentAmount), created.startDate.toISOString()], ['SOCIAL_MEDIA', 'PLANNED', 10_000_000, 0, '2027-03-15T20:30:00.000Z']);

  const before = await snapshot();
  assert.equal((await campaign({ startDate: '' })).message, 'لطفا فیلدهای الزامی را پر کنید.');
  assert.equal((await campaign({ startDate: 'نامعتبر' })).message, 'تاریخ کمپین نامعتبر است.');
  assert.equal((await campaign({ endDate: '2027-03-01T20:30:00.000Z' })).message, 'تاریخ پایان کمپین نباید پیش از تاریخ شروع باشد.');
  assert.equal((await campaign({ budget: '-1' })).message, 'لطفا فیلدهای الزامی را پر کنید.');
  assert.equal((await campaign({ status: 'WHATEVER' })).message, 'لطفا فیلدهای الزامی را پر کنید.');
  for (const role of NON_SELLERS) {
    setTestRole(role);
    assert.equal((await campaign({})).message, DENIED, String(role));
  }
  assert.deepEqual(await snapshot(), before);
  for (const role of SELLERS) {
    setTestRole(role);
    assert.equal((await campaign({ name: `کمپین ${role}` })).success, true, role);
  }
  assert.ok(w.campaign.id);
});

test('the marketing screens add up to the gift rows: gifts, spend per campaign, remaining budget', async () => {
  const w = await world();
  await gift(w, [{ productId: w.frame.id, quantity: 2 }]);
  await gift(w, [{ productId: w.caseItem.id, quantity: 4 }], { campaignId: '' });
  const listed = await getMarketingGifts();
  assert.deepEqual(listed.map((g: any) => [g.product.name, g.quantity, g.totalCost, g.campaign?.name ?? null]).sort(), [['PANJ', 2, 2 * COST, 'یلدا'], ['جلد', 4, 200_000, null]].sort());
  const [campaign] = await getMarketingCampaigns();
  assert.deepEqual([campaign.spentAmount, campaign.budget, campaign._count.gifts], [2 * COST, 5_000_000, 1]);
  const stats = await getMarketingStats();
  assert.deepEqual(
    [stats.totalGifts, stats.totalQuantity, stats.totalCost, stats.totalCampaigns, stats.activeCampaigns, stats.totalBudget, stats.totalSpent, stats.remainingBudget],
    [2, 6, 2 * COST + 200_000, 1, 1, 5_000_000, 2 * COST, 5_000_000 - 2 * COST],
  );
  // The gift expense in the ledger is the same total.
  const ledger = (await prisma.transaction.findMany({ where: { category: 'Marketing - Gift' } })).reduce((sum: number, row: any) => sum + Number(row.amountInToman), 0);
  assert.equal(ledger, stats.totalCost);
});
