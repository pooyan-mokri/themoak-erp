import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { AccessDenied } from '@/lib/access';
import {
  applyPromotion,
  createPromotion,
  deactivatePromotion,
  deletePromotion,
  getActivePromotions,
  getPromotionById,
  getPromotions,
  giftProductToCustomer,
  incrementPromotionUsage,
} from '@/actions/promotion';
import { DENIED, NON_SELLERS, NON_VIEWERS, SELLERS, assertInvariants, quantityOf, snapshot, stockIn } from '../sales/world';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const fields = (extra: Record<string, string> = {}) =>
  form({ name: 'حراج پاییز', type: 'DISCOUNT', description: '', startDate: '2026-09-20', endDate: '2026-10-05', discountPercent: '15', discountAmount: '', minPurchase: '', maxUses: '', ...extra });

/** A promotion as stored, straight in the table (applyPromotion is checked against now). */
async function promotion(data: Record<string, unknown> = {}) {
  const now = Date.now();
  return prisma.promotion.create({
    data: { name: 'حراج', type: 'DISCOUNT', startDate: new Date(now - 86_400_000), endDate: new Date(now + 86_400_000), discountPercent: 15, ...data },
  });
}

test('a promotion runs from the start of its first Tehran day to the end of its last', async () => {
  assert.deepEqual(await createPromotion(undefined, fields()), { message: 'کمپین تبلیغاتی با موفقیت ایجاد شد.', success: true });
  const [created] = await getPromotions();
  assert.equal(created.startDate.toISOString(), '2026-09-19T20:30:00.000Z');
  assert.equal(created.endDate.toISOString(), '2026-10-05T20:29:59.999Z');
  assert.deepEqual([created.type, created.discountPercent, created.discountAmount, created.maxUses, created.isActive], ['DISCOUNT', 15, undefined, undefined, true]);
  assert.equal((await getPromotionById(created.id))!.name, 'حراج پاییز');
  assert.equal(await getPromotionById('no-such-promotion'), undefined);
});

test('a promotion with a percent above 100, amounts below 0, a fractional or zero use limit, an unknown type or its end before its start is refused', async () => {
  const before = await snapshot();
  const invalid = 'لطفا فیلدهای الزامی را پر کنید.';
  const cases: Array<Record<string, string>> = [
    { discountPercent: '101' },
    { discountPercent: '-5' },
    { discountAmount: '-1' },
    { minPurchase: '-1' },
    { maxUses: '1.5' },
    { maxUses: '0' },
    { type: 'LOTTERY' },
    { name: '' },
    { discountPercent: 'abc' },
  ];
  for (const extra of cases) {
    assert.equal((await createPromotion(undefined, fields(extra))).message, invalid, JSON.stringify(extra));
  }
  assert.equal((await createPromotion(undefined, fields({ startDate: '2026-10-06' }))).message, 'تاریخ پایان کمپین نباید پیش از تاریخ شروع باشد.');
  assert.equal((await createPromotion(undefined, fields({ endDate: 'فردا' }))).message, 'تاریخ کمپین نامعتبر است.');
  for (const role of NON_SELLERS) {
    setTestRole(role);
    assert.equal((await createPromotion(undefined, fields())).message, DENIED, String(role));
  }
  assert.deepEqual(await snapshot(), before);
  // A one-day promotion is fine.
  setTestRole('ADMIN');
  assert.equal((await createPromotion(undefined, fields({ startDate: '2026-10-05' }))).success, true);
});

test('the active promotions are those running now, switched on, with uses left', async () => {
  const running = await promotion({ name: 'running' });
  await promotion({ name: 'switched off', isActive: false });
  await promotion({ name: 'not started', startDate: new Date(Date.now() + 3_600_000) });
  await promotion({ name: 'over', endDate: new Date(Date.now() - 1_000) });
  await promotion({ name: 'used up', maxUses: 3, usedCount: 3 });
  const left = await promotion({ name: 'one use left', maxUses: 3, usedCount: 2 });
  assert.deepEqual((await getActivePromotions()).map((p: any) => p.name).sort(), ['one use left', 'running']);
  assert.ok(running.id && left.id);
});

test('applying a promotion: a percent or an amount off, never more than the order, within its minimum and its uses', async () => {
  const percent = await promotion({ discountPercent: 15 });
  assert.deepEqual(await applyPromotion(percent.id, 2_000_000), { success: true, discountAmount: 300_000, giftProductId: undefined, promotionName: 'حراج' });
  const fixed = await promotion({ discountPercent: null, discountAmount: 500_000, minPurchase: 1_000_000 });
  assert.equal((await applyPromotion(fixed.id, 1_000_000) as any).discountAmount, 500_000);
  assert.match((await applyPromotion(fixed.id, 999_999)).message ?? '', /حداقل مبلغ خرید/);
  const big = await promotion({ discountPercent: null, discountAmount: 5_000_000 });
  assert.equal((await applyPromotion(big.id, 1_200_000) as any).discountAmount, 1_200_000, 'capped at the order total');
  const giftPromo = await promotion({ type: 'GIFT', productId: 'frame-id', discountPercent: null });
  assert.deepEqual(await applyPromotion(giftPromo.id, 10), { success: true, discountAmount: 0, giftProductId: 'frame-id', promotionName: 'حراج' });

  assert.deepEqual(await applyPromotion(percent.id, -1), { success: false, message: 'مبلغ سفارش نامعتبر است.' });
  assert.deepEqual(await applyPromotion('no-such-promotion', 1), { success: false, message: 'کمپین یافت نشد.' });
  const off = await promotion({ isActive: false });
  assert.deepEqual(await applyPromotion(off.id, 1), { success: false, message: 'این کمپین فعال نیست.' });
  const usedUp = await promotion({ maxUses: 1, usedCount: 1 });
  assert.deepEqual(await applyPromotion(usedUp.id, 1), { success: false, message: 'این کمپین به حداکثر استفاده رسیده است.' });
});

test('a use is counted only while uses are left, also when the last one is taken twice at once', async () => {
  const limited = await promotion({ maxUses: 2 });
  assert.deepEqual(await incrementPromotionUsage(limited.id), { success: true });
  const both = await Promise.all([incrementPromotionUsage(limited.id), incrementPromotionUsage(limited.id)]);
  assert.deepEqual(both.map((r: any) => r.success).sort(), [false, true]);
  assert.equal((await prisma.promotion.findUniqueOrThrow({ where: { id: limited.id } })).usedCount, 2);
  assert.deepEqual(await incrementPromotionUsage(limited.id), { success: false, message: 'این کمپین به حداکثر استفاده رسیده است.' });
  const open = await promotion();
  for (let i = 0; i < 3; i++) assert.equal((await incrementPromotionUsage(open.id) as any).success, true);
  assert.equal((await prisma.promotion.findUniqueOrThrow({ where: { id: open.id } })).usedCount, 3);
  assert.deepEqual(await incrementPromotionUsage('no-such-promotion'), { success: false, message: 'کمپین یافت نشد.' });
});

test('switching off and deleting a promotion; every write needs sales.manage and every read sales.view', async () => {
  const p = await promotion();
  const before = await snapshot();
  for (const role of NON_SELLERS) {
    setTestRole(role);
    assert.equal((await deactivatePromotion(p.id)).message, DENIED, String(role));
    assert.equal((await deletePromotion(p.id)).message, DENIED, String(role));
    assert.equal((await incrementPromotionUsage(p.id) as any).message, DENIED, String(role));
    assert.equal((await applyPromotion(p.id, 1)).message, DENIED, String(role));
  }
  assert.deepEqual(await snapshot(), before);
  for (const role of NON_VIEWERS) {
    setTestRole(role);
    await assert.rejects(getPromotions(), AccessDenied, String(role));
    await assert.rejects(getActivePromotions(), AccessDenied, String(role));
  }
  setTestRole(SELLERS[2]);
  assert.deepEqual(await deactivatePromotion(p.id), { success: true, message: 'کمپین غیرفعال شد.' });
  assert.equal((await prisma.promotion.findUniqueOrThrow({ where: { id: p.id } })).isActive, false);
  assert.deepEqual(await deletePromotion(p.id), { success: true, message: 'کمپین حذف شد.' });
  assert.equal(await prisma.promotion.count(), 0);
  assert.equal((await deletePromotion(p.id)).success, false);
});

test('a product given to a customer is a 0-price order that takes the stock once, with its SALE movement', async () => {
  const store = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 1, sellPrice: 2 } });
  await stockIn(frame.id, store.id, 2);
  const customer = await prisma.customer.create({ data: { name: 'سارا' } });

  const result = await giftProductToCustomer(customer.id, frame.id, 2, store.id);
  assert.equal(result.success, true, result.message);
  const order = await prisma.order.findFirstOrThrow({ include: { items: true } });
  assert.deepEqual([Number(order.totalAmount), order.paymentStatus, order.items[0].quantity, Number(order.items[0].price)], [0, 'PAID', 2, 0]);
  assert.equal(await quantityOf(frame.id, store.id), 0);
  await assertInvariants();

  const before = await snapshot();
  assert.deepEqual(await giftProductToCustomer(customer.id, frame.id, 1, store.id), { success: false, message: 'موجودی کافی نیست.' });
  assert.deepEqual(await giftProductToCustomer(customer.id, 'no-such-product', 1, store.id), { success: false, message: 'محصول یافت نشد.' });
  for (const quantity of [0, -1, 1.5]) {
    assert.deepEqual(await giftProductToCustomer(customer.id, frame.id, quantity, store.id), { success: false, message: 'تعداد هدیه باید عددی صحیح و بیشتر از صفر باشد.' });
  }
  setTestRole('WAREHOUSE');
  assert.equal((await giftProductToCustomer(customer.id, frame.id, 1, store.id)).message, DENIED);
  assert.deepEqual(await snapshot(), before);
});
