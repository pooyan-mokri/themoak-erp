import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { createPurchaseOrder, createSupplier, getPurchaseOrder, getPurchaseOrders, getSuppliers } from '@/actions/supplier';
import { recordPurchasePartialPayment } from '@/actions/supplier-workflow';
import { EUR_RATE, USD_RATE, assertPurchaseInvariants, order, purchasingWorld, type World } from './world';

// Creating purchase orders: the cost.edit guard, currencies and the rate snapshot, additional costs in
// Toman and other currencies, and what the order pages read back.

console.error = () => {};
console.log = () => {};

const DENIED = 'شما به این بخش دسترسی ندارید.';
let w: World;

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
  w = await purchasingWorld();
});
after(() => prisma.$disconnect());

test('a Toman order: lines and additional costs make the total exactly once, as a DRAFT with its tags', async () => {
  const created = await createPurchaseOrder({
    supplierId: w.supplier.id,
    items: [
      { productId: w.panj.id, quantity: 10, unitCost: 100_000, currency: 'TOMAN' },
      { productId: w.yek.id, quantity: 5, unitCost: 400_000, currency: 'TOMAN' },
    ],
    additionalCosts: [{ title: 'حمل', amount: 150_000, currency: 'TOMAN' }, { title: 'بیمه', amount: 50_000, currency: 'TOMAN' }],
    tags: ['پاییز'],
  });
  assert.deepEqual(created, { success: true, message: 'سفارش خرید با موفقیت ثبت شد' });
  const po = await prisma.purchaseOrder.findFirstOrThrow({ include: { items: true, additionalCosts: true } });
  assert.deepEqual([po.status, po.tags, Number(po.totalAmount), Number(po.totalAmountInToman)], ['DRAFT', ['پاییز'], 3_200_000, 3_200_000]);
  assert.deepEqual(
    po.items.map((i: any) => [i.quantity, Number(i.unitCost), i.currency, Number(i.exchangeRateSnapshot), Number(i.unitCostInToman), i.receivedQuantity]).sort(),
    [[10, 100_000, 'TOMAN', 1, 100_000, 0], [5, 400_000, 'TOMAN', 1, 400_000, 0]].sort(),
  );
  assert.deepEqual(po.additionalCosts.map((c: any) => Number(c.amountInToman)).sort(), [150_000, 50_000].sort());
  await assertPurchaseInvariants();
});

test('a dollar order snapshots today\'s rate on every line and cost; a later rate leaves the order as it was', async () => {
  const po = await order(w, [{ productId: w.panj.id, quantity: 10, unitCost: 50, currency: 'USD' }], [
    { title: 'حمل هوایی', amount: 20, currency: 'USD' },
    { title: 'ترخیص', amount: 1_000_000, currency: 'TOMAN' },
  ]);
  assert.deepEqual(
    [Number(po.items[0].exchangeRateSnapshot), Number(po.items[0].unitCostInToman), Number(po.totalAmountInToman)],
    [USD_RATE, 50 * USD_RATE, 500 * USD_RATE + 20 * USD_RATE + 1_000_000],
  );
  // The total in the first line's currency: every Toman figure divided by its rate.
  assert.equal(Number(po.totalAmount), (500 * USD_RATE + 20 * USD_RATE + 1_000_000) / USD_RATE);

  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 130_000, date: new Date('2026-09-20') } });
  const again = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: { items: true } });
  assert.equal(Number(again.totalAmountInToman), 53_000_000);
  // The next order takes the newest rate.
  const next = await order(w, [{ productId: w.panj.id, quantity: 1, unitCost: 50, currency: 'USD' }]);
  assert.equal(Number(next.items[0].unitCostInToman), 50 * 130_000);
  await assertPurchaseInvariants();
});

test('a mixed-currency order converts each line and cost at its own rate', async () => {
  const po = await order(w, [
    { productId: w.panj.id, quantity: 2, unitCost: 100, currency: 'EUR' },
    { productId: w.yek.id, quantity: 3, unitCost: 1_000_000, currency: 'TOMAN' },
  ], [{ title: 'حمل', amount: 10, currency: 'USD' }]);
  assert.equal(Number(po.totalAmountInToman), 2 * 100 * EUR_RATE + 3_000_000 + 10 * USD_RATE);
  assert.equal(Number(po.totalAmount), Number(po.totalAmountInToman) / EUR_RATE);
  await assertPurchaseInvariants();
});

test('a currency without a rate is refused in Persian, for a line or a cost, and nothing is written', async () => {
  const line = await createPurchaseOrder({ supplierId: w.supplier.id, items: [{ productId: w.panj.id, quantity: 1, unitCost: 10, currency: 'CNY' }] });
  assert.deepEqual(line, { success: false, error: 'نرخ ارز برای CNY یافت نشد. لطفا ابتدا نرخ روز را در بخش حسابداری ثبت کنید.' });
  const cost = await createPurchaseOrder({
    supplierId: w.supplier.id,
    items: [{ productId: w.panj.id, quantity: 1, unitCost: 10, currency: 'TOMAN' }],
    additionalCosts: [{ title: 'حمل', amount: 5, currency: 'CNY' }],
  });
  assert.match(cost.error!, /CNY/);
  assert.equal(await prisma.purchaseOrder.count(), 0);
});

test('invalid orders are refused with a Persian message and write nothing', async () => {
  const item = { productId: w.panj.id, quantity: 1, unitCost: 1_000, currency: 'TOMAN' as const };
  const cases: Array<[any, RegExp]> = [
    [{ supplierId: '', items: [item] }, /تامین‌کننده الزامی است/],
    [{ supplierId: w.supplier.id, items: [] }, /حداقل یک محصول/],
    [{ supplierId: w.supplier.id, items: [{ ...item, quantity: 0 }] }, /بیشتر از ۰/],
    [{ supplierId: w.supplier.id, items: [{ ...item, quantity: 1.5 }] }, /عدد صحیح/],
    [{ supplierId: w.supplier.id, items: [{ ...item, unitCost: -1 }] }, /منفی/],
    [{ supplierId: w.supplier.id, items: [{ ...item, productId: '' }] }, /محصول الزامی است/],
    [{ supplierId: w.supplier.id, items: [item], additionalCosts: [{ title: '', amount: 1, currency: 'TOMAN' }] }, /عنوان هزینه/],
    [{ supplierId: w.supplier.id, items: [item], additionalCosts: [{ title: 'حمل', amount: -1, currency: 'TOMAN' }] }, /مبلغ/],
    [{ supplierId: 'no-such-supplier', items: [item] }, /رکورد مرتبط یافت نشد/],
    [{ supplierId: w.supplier.id, items: [{ ...item, productId: 'no-such-product' }] }, /رکورد مرتبط یافت نشد/],
  ];
  for (const [input, message] of cases) {
    const result = await createPurchaseOrder(input);
    assert.equal(result.success, false, JSON.stringify(input));
    assert.match(result.error!, message, JSON.stringify(input));
  }
  assert.equal(await prisma.purchaseOrder.count(), 0);
  assert.equal(await prisma.purchaseOrderItem.count(), 0);
});

test('a free line and a zero cost are allowed; a very large order keeps every toman', async () => {
  const po = await order(w, [
    { productId: w.panj.id, quantity: 100_000, unitCost: 987_654_321 },
    { productId: w.yek.id, quantity: 1, unitCost: 0 },
  ], [{ title: 'رایگان', amount: 0, currency: 'TOMAN' }]);
  assert.equal(Number(po.totalAmountInToman), 98_765_432_100_000);
  await assertPurchaseInvariants();
});

test('only cost.edit creates an order: every other role is refused and nothing is written', async () => {
  const input = { supplierId: w.supplier.id, items: [{ productId: w.panj.id, quantity: 1, unitCost: 1, currency: 'TOMAN' as const }] };
  for (const role of ['AUDITOR', 'ACCOUNTANT', 'SALES', 'WAREHOUSE', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    assert.deepEqual(await createPurchaseOrder(input), { success: false, error: DENIED, message: DENIED }, String(role));
  }
  assert.equal(await prisma.purchaseOrder.count(), 0);
});

test('getPurchaseOrder: Decimal fields as numbers, payments oldest first with their account, and the paid sum', async () => {
  const po = await order(w, [{ productId: w.panj.id, quantity: 10, unitCost: 100_000 }], [{ title: 'حمل', amount: 200_000, currency: 'TOMAN' }], 'PENDING_PAYMENT');
  await recordPurchasePartialPayment({ orderId: po.id, accountId: 'toman', amount: 300_000, date: '2026-09-02T10:00:00.000Z' });
  await recordPurchasePartialPayment({ orderId: po.id, accountId: 'usd', amount: 500_000, date: '2026-09-01T10:00:00.000Z' });
  const { data }: any = await getPurchaseOrder(po.id);
  assert.deepEqual([data.totalAmountInToman, data.paidAmountInToman, data.status], [1_200_000, 800_000, 'PARTIALLY_PAID']);
  assert.deepEqual(data.payments.map((p: any) => [p.amount, p.accountName]), [[500_000, 'حساب usd'], [300_000, 'حساب toman']]);
  assert.deepEqual([data.items[0].unitCost, data.items[0].unitCostInToman, data.additionalCosts[0].amount], [100_000, 100_000, 200_000]);
  assert.deepEqual(await getPurchaseOrder('missing'), { success: false, error: 'سفارش یافت نشد' });

  const list: any = await getPurchaseOrders();
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].totalAmountInToman, 1_200_000);
  await assertPurchaseInvariants();
});

test('suppliers: created with stock.manage or finance.manage, listed with their order counts; bad input refused', async () => {
  await order(w, [{ productId: w.panj.id, quantity: 1, unitCost: 1 }]);
  setTestRole('WAREHOUSE');
  assert.deepEqual(await createSupplier({}, form({ name: 'Safilo', phone: '021', email: '', address: 'میلان' })), {
    success: true,
    message: 'تامین‌کننده با موفقیت ایجاد شد',
  });
  assert.deepEqual(await createSupplier({}, form({ name: '' })), { success: false, error: 'نام تامین‌کننده الزامی است' });
  assert.deepEqual(await createSupplier({}, form({ name: 'X', email: 'not-an-email' })), { success: false, error: 'ایمیل نامعتبر است' });
  const suppliers: any = await getSuppliers();
  assert.deepEqual(suppliers.data.map((s: any) => [s.name, s._count.orders, s.email]).sort(), [['Mazzucchelli', 1, undefined], ['Safilo', 0, undefined]]);
  for (const role of ['AUDITOR', 'SALES', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    assert.equal((await createSupplier({}, form({ name: 'Z' }))).error, DENIED, String(role));
  }
  assert.equal(await prisma.supplier.count(), 2);
});
