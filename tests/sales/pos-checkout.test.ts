import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { createOrder } from '@/actions/sales';
import { DUPLICATE_REQUEST_MESSAGE } from '@/lib/request-id';
import { INVALID_RECEIPT_MESSAGE } from '@/lib/receipt-ref';
import { CHANNELS_FIELD } from '@/lib/consignment-channels';
import { createConsignmentPartner, updateConsignmentPartner } from '@/actions/consignment';
import { form } from '../helpers/db';
import {
  DENIED,
  NON_SELLERS,
  SELLERS,
  assertInvariants,
  balanceOf,
  openAccount,
  quantityOf,
  sleep,
  snapshot,
  stockIn,
} from './world';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const PRICE = 10_000_000;
const COST = 4_000_000;
const OPENING = 50_000_000;
const RATE = 100_000; // Toman per USD
const RECEIPT = 'ftp:/receipts/2026/0f8fad5b-d9cb-469f-a165-70867728950e.jpg';

beforeEach(async () => {
  beforeQuery.fn = null;
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/** The shop: مشاهیر holds 10 frames and 5 cases, انبار مرکزی 3 frames; a customer; a bank, a till and a dollar account. */
async function shop() {
  const store = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const central = await prisma.warehouse.create({ data: { name: 'انبار مرکزی' } });
  const frame = await prisma.product.create({ data: { name: 'PANJ - Blue', sku: 'PANJ/BLUE', costPrice: COST, sellPrice: PRICE } });
  const caseItem = await prisma.product.create({ data: { name: 'جلد', sku: 'CASE', costPrice: 100_000, sellPrice: 500_000 } });
  await stockIn(frame.id, store.id, 10);
  await stockIn(caseItem.id, store.id, 5);
  await stockIn(frame.id, central.id, 3);
  const customer = await prisma.customer.create({ data: { name: 'سارا' } });
  const bank = await openAccount('بانک سامان', { opening: OPENING });
  const till = await openAccount('صندوق', { type: 'CASH', opening: OPENING });
  const usd = await openAccount('حساب دلاری', { currency: 'USD', opening: 1_000 });
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 90_000, date: new Date('2026-09-01') } });
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: RATE, date: new Date('2026-09-20') } });
  return { store, central, frame, caseItem, customer, bank, till, usd };
}
type Shop = Awaited<ReturnType<typeof shop>>;

type Sale = Partial<Parameters<typeof createOrder>[0]>;

/** A checkout of `quantity` frames from مشاهیر, paid in full into the bank unless told otherwise. */
function sell(s: Shop, quantity = 1, extra: Sale = {}) {
  return createOrder({
    customerId: s.customer.id,
    items: [{ productId: s.frame.id, quantity, price: PRICE }],
    paymentMethod: 'CASH',
    accountId: s.bank.id,
    totalAmount: PRICE * quantity,
    warehouseId: s.store.id,
    ...extra,
  });
}

const theOrder = () => prisma.order.findFirstOrThrow({ include: { items: true, commissions: true } });

test('a checkout paid in full books the order, one income row on it, the bank, the stock and a SALE movement', async () => {
  const s = await shop();
  const result = await sell(s, 2, {
    items: [
      { productId: s.frame.id, quantity: 2, price: PRICE },
      { productId: s.caseItem.id, quantity: 1, price: 500_000 },
    ],
    totalAmount: 2 * PRICE + 500_000,
    saleDate: '2026-09-20T08:30:00.000Z',
    tags: ['اینستاگرام'],
    invoiceAccountId: undefined,
    requestId: 'pos-checkout-0001',
    receiptUrl: RECEIPT,
  });
  assert.deepEqual(result, { success: true, message: 'سفارش با موفقیت ثبت شد.' });

  const order = await theOrder();
  assert.deepEqual(
    [Number(order.totalAmount), Number(order.discount), Number(order.paidAmount), order.paymentStatus, order.status, order.customerId, order.tags],
    [2 * PRICE + 500_000, 0, 2 * PRICE + 500_000, 'PAID', 'COMPLETED', s.customer.id, ['اینستاگرام']],
  );
  assert.equal(order.createdAt.toISOString(), '2026-09-20T08:30:00.000Z');
  assert.deepEqual(
    order.items.map((item: any) => [item.productId, item.quantity, Number(item.price), item.warehouseId]).sort(),
    [[s.frame.id, 2, PRICE, s.store.id], [s.caseItem.id, 1, 500_000, s.store.id]].sort(),
  );

  const [income] = await prisma.transaction.findMany({ where: { orderId: order.id } });
  assert.equal(order.transactionId, income.id);
  assert.deepEqual(
    [income.type, Number(income.amount), Number(income.amountInToman), Number(income.rateSnapshot), income.currency, income.accountId, income.customerId, income.category, income.clientRequestId, income.receiptUrl],
    ['INCOME', 2 * PRICE + 500_000, 2 * PRICE + 500_000, 1, 'TOMAN', s.bank.id, s.customer.id, 'Sales', 'pos-checkout-0001', RECEIPT],
  );
  assert.equal(income.date.toISOString(), '2026-09-20T08:30:00.000Z');
  assert.equal(await balanceOf(s.bank.id), OPENING + 2 * PRICE + 500_000);

  assert.deepEqual([await quantityOf(s.frame.id, s.store.id), await quantityOf(s.caseItem.id, s.store.id)], [8, 4]);
  assert.equal(await quantityOf(s.frame.id, s.central.id), 3, 'the other warehouse is not touched');
  const sales = await prisma.inventoryMovement.findMany({ where: { type: 'SALE' } });
  assert.deepEqual(
    sales.map((m: any) => [m.productId, m.fromWarehouseId, m.toWarehouseId, m.quantity, m.referenceId]).sort(),
    [[s.frame.id, s.store.id, null, 2, order.id], [s.caseItem.id, s.store.id, null, 1, order.id]].sort(),
  );
  // A POS sale books no COGS row and no commission (neither is recorded for an ordinary sale).
  assert.equal(await prisma.transaction.count({ where: { category: 'COGS' } }), 0);
  assert.equal(order.commissions.length, 0);
  await assertInvariants();
});

test('a discount is taken off what is owed: paid in full, part-paid and on credit', async () => {
  const s = await shop();
  const cases: Array<[number | undefined, number, string]> = [
    [undefined, 18_000_000, 'PAID'], // no paid amount given: the total after discount
    [18_000_000, 18_000_000, 'PAID'],
    [5_000_000, 5_000_000, 'PARTIAL'],
    [0, 0, 'UNPAID'],
  ];
  for (const [paidAmount, paid, status] of cases) {
    const result = await sell(s, 2, { discount: 2_000_000, paidAmount, accountId: paidAmount === 0 ? '' : s.bank.id });
    assert.equal(result.success, true, result.message);
    const order = await prisma.order.findFirstOrThrow({ orderBy: { number: 'desc' } });
    assert.deepEqual([Number(order.totalAmount), Number(order.discount), Number(order.paidAmount), order.paymentStatus], [2 * PRICE, 2_000_000, paid, status]);
  }
  await assertInvariants();
});

test('a credit sale books no money row and leaves every account alone', async () => {
  const s = await shop();
  const result = await sell(s, 1, { paidAmount: 0, accountId: '' });
  assert.equal(result.success, true, result.message);
  const order = await theOrder();
  assert.deepEqual([Number(order.paidAmount), order.paymentStatus, order.transactionId], [0, 'UNPAID', null]);
  assert.equal(await prisma.transaction.count({ where: { orderId: order.id } }), 0);
  assert.deepEqual([await balanceOf(s.bank.id), await balanceOf(s.till.id)], [OPENING, OPENING]);
  assert.equal(await quantityOf(s.frame.id, s.store.id), 9);
  await assertInvariants();
});

test('money taken into the dollar account moves it by amount ÷ the latest rate, and the row keeps the Toman figure', async () => {
  const s = await shop();
  const result = await sell(s, 1, { accountId: s.usd.id, paidAmount: 5_000_000 });
  assert.equal(result.success, true, result.message);
  const [income] = await prisma.transaction.findMany({ where: { type: 'INCOME' } });
  assert.deepEqual(
    [income.currency, Number(income.amount), Number(income.amountInToman), Number(income.rateSnapshot)],
    ['USD', 50, 5_000_000, RATE],
  );
  assert.equal(await balanceOf(s.usd.id), 1_000 + 50);
  assert.equal((await theOrder()).paymentStatus, 'PARTIAL');
  await assertInvariants();
});

test('a dollar account without any rate refuses the checkout and writes nothing', async () => {
  const s = await shop();
  await prisma.exchangeRate.deleteMany({});
  const before = await snapshot();
  const result = await sell(s, 1, { accountId: s.usd.id });
  assert.deepEqual(result, { success: false, message: 'نرخ تبدیل برای ارز USD یافت نشد. لطفا ابتدا نرخ امروز را وارد کنید.' });
  assert.deepEqual(await snapshot(), before);
});

test('an unknown receiving account, or a receipt that is not a stored file, is refused and nothing is written', async () => {
  const s = await shop();
  const before = await snapshot();
  assert.deepEqual(await sell(s, 1, { accountId: 'no-such-account' }), { success: false, message: 'حساب دریافت وجه یافت نشد.' });
  assert.deepEqual(await sell(s, 1, { accountId: '' }), { success: false, message: 'حساب دریافت وجه یافت نشد.' });
  assert.deepEqual(await sell(s, 1, { receiptUrl: 'https://evil.example/receipt.jpg' }), { success: false, message: INVALID_RECEIPT_MESSAGE });
  assert.deepEqual(await snapshot(), before);
});

test('without a chosen warehouse each line is taken from a warehouse that holds it, and never from a partner or an archived one', async () => {
  const s = await shop();
  const lens = await prisma.product.create({ data: { name: 'عدسی', sku: 'LENS', costPrice: 1, sellPrice: 2_000_000 } });
  // A partner's consignment stock and an archived warehouse are created first, so an unfiltered pick would find them.
  const partner = await prisma.customer.create({ data: { name: 'همکار' } });
  const atPartner = await prisma.warehouse.create({ data: { name: 'انبار امانی - همکار', isVirtual: true, customerId: partner.id } });
  const archived = await prisma.warehouse.create({ data: { name: 'انبار قدیمی', isArchived: true } });
  await stockIn(lens.id, atPartner.id, 5);
  await stockIn(lens.id, archived.id, 5);
  await stockIn(lens.id, s.central.id, 2);

  const result = await createOrder({
    customerId: s.customer.id,
    items: [
      { productId: s.caseItem.id, quantity: 2, price: 500_000 }, // only in مشاهیر
      { productId: lens.id, quantity: 2, price: 2_000_000 }, // only in انبار مرکزی among our live warehouses
    ],
    paymentMethod: 'CASH',
    accountId: s.bank.id,
    totalAmount: 2 * 500_000 + 2 * 2_000_000,
  });
  assert.equal(result.success, true, result.message);

  const order = await theOrder();
  const where = Object.fromEntries(order.items.map((item: any) => [item.productId, item.warehouseId]));
  assert.deepEqual(where, { [s.caseItem.id]: s.store.id, [lens.id]: s.central.id });
  assert.deepEqual(
    [await quantityOf(s.caseItem.id, s.store.id), await quantityOf(lens.id, s.central.id), await quantityOf(lens.id, atPartner.id), await quantityOf(lens.id, archived.id)],
    [3, 0, 5, 5],
  );
  await assertInvariants();

  // Nothing left in a live warehouse of ours: refused, though the partner still holds some.
  const refused = await createOrder({
    customerId: s.customer.id,
    items: [{ productId: lens.id, quantity: 1, price: 2_000_000 }],
    paymentMethod: 'CASH',
    accountId: s.bank.id,
    totalAmount: 2_000_000,
  });
  assert.deepEqual(refused, { success: false, message: 'موجودی کافی برای محصول "عدسی" وجود ندارد.' });
});

test('more than the chosen warehouse holds is refused, also over two lines of one product, and nothing is written', async () => {
  const s = await shop();
  const before = await snapshot();
  const tooMany = await sell(s, 11);
  assert.deepEqual(tooMany, { success: false, message: 'موجودی کافی برای محصول "PANJ - Blue" در انبار انتخابی وجود ندارد.' });
  // 6 + 6 of 10: each line alone fits, both do not. The first line's stock and the money go back.
  const split = await sell(s, 12, {
    items: [
      { productId: s.frame.id, quantity: 6, price: PRICE },
      { productId: s.frame.id, quantity: 6, price: PRICE },
    ],
  });
  assert.equal(split.success, false);
  assert.deepEqual(await snapshot(), before);
  // Exactly what is held is fine.
  assert.equal((await sell(s, 10)).success, true);
  assert.equal(await quantityOf(s.frame.id, s.store.id), 0);
  await assertInvariants();
});

test('lines that are not a whole positive number of units at a price of 0 or more are refused, and nothing is written', async () => {
  const s = await shop();
  const before = await snapshot();
  const line = (quantity: number, price = PRICE) =>
    sell(s, 1, { items: [{ productId: s.frame.id, quantity, price }], totalAmount: Math.max(0, quantity * price), paidAmount: 0, accountId: '' });
  for (const quantity of [0, -1, 1.5, Number.NaN]) {
    const result = await line(quantity);
    assert.equal(result.success, false, `quantity ${quantity}`);
    assert.equal(result.message, 'تعداد هر قلم باید عددی صحیح و بیشتر از صفر باشد.', `quantity ${quantity}`);
  }
  const negativePrice = await line(1, -PRICE);
  assert.deepEqual(negativePrice, { success: false, message: 'قیمت هر قلم باید صفر یا بیشتر باشد.' });
  assert.deepEqual(await sell(s, 1, { items: [] }), { success: false, message: 'سبد خرید خالی است.' });
  assert.deepEqual(await snapshot(), before);
  assert.equal(await quantityOf(s.frame.id, s.store.id), 10, 'a negative quantity never adds stock');
});

test('a total that is not the sum of the lines, or a discount below 0 or above the total, is refused', async () => {
  const s = await shop();
  const before = await snapshot();
  assert.deepEqual(await sell(s, 2, { totalAmount: PRICE }), {
    success: false,
    message: 'مبلغ کل سفارش با جمع اقلام آن نمی‌خواند.',
  });
  assert.deepEqual(await sell(s, 1, { discount: -1_000_000, paidAmount: 0, accountId: '' }), {
    success: false,
    message: 'تخفیف باید بین صفر و مبلغ کل سفارش باشد.',
  });
  assert.deepEqual(await sell(s, 1, { discount: PRICE + 1, paidAmount: 0, accountId: '' }), {
    success: false,
    message: 'تخفیف باید بین صفر و مبلغ کل سفارش باشد.',
  });
  assert.deepEqual(await snapshot(), before);

  // A discount of the whole total: a free sale, PAID with nothing received.
  const free = await sell(s, 1, { discount: PRICE, accountId: '' });
  assert.equal(free.success, true, free.message);
  const order = await theOrder();
  assert.deepEqual([Number(order.paidAmount), order.paymentStatus], [0, 'PAID']);
  assert.equal(await prisma.transaction.count({ where: { orderId: order.id } }), 0);
  await assertInvariants();
});

test('an unknown customer is refused in Persian and nothing is written', async () => {
  const s = await shop();
  const before = await snapshot();
  const result = await sell(s, 1, { customerId: 'no-such-customer' });
  assert.deepEqual(result, { success: false, message: 'مشتری یافت نشد.' });
  assert.deepEqual(await snapshot(), before);
});

test('very large amounts are booked exactly', async () => {
  const s = await shop();
  const huge = 9_000_000_000_000; // 9,000 billion Toman
  const result = await sell(s, 1, { items: [{ productId: s.frame.id, quantity: 1, price: huge }], totalAmount: huge, discount: 1, paidAmount: huge - 1 });
  assert.equal(result.success, true, result.message);
  const order = await theOrder();
  assert.deepEqual([Number(order.totalAmount), Number(order.paidAmount), order.paymentStatus], [huge, huge - 1, 'PAID']);
  assert.equal(await balanceOf(s.bank.id), OPENING + huge - 1);
  await assertInvariants();
});

test('a checkout that fails half way writes nothing at all', async () => {
  const s = await shop();
  const before = await snapshot();
  beforeQuery.fn = async (params) => {
    if (params.model === 'InventoryMovement' && params.action === 'create') throw new Error('simulated failure');
  };
  const result = await sell(s, 2, { requestId: 'pos-failing-0001' });
  beforeQuery.fn = null;
  assert.equal(result.success, false);
  assert.deepEqual(await snapshot(), before);
  // The same submission can then go through.
  assert.equal((await sell(s, 2, { requestId: 'pos-failing-0001' })).success, true);
  assert.equal(await prisma.order.count(), 1);
});

test('a credit sale sent twice with the same requestId is one sale, one after the other and at the same time', async () => {
  const s = await shop();
  const credit = { paidAmount: 0, accountId: '', requestId: 'pos-credit-0001' };
  assert.deepEqual(await sell(s, 1, credit), { success: true, message: 'سفارش با موفقیت ثبت شد.' });
  assert.deepEqual(await sell(s, 1, credit), { success: true, message: DUPLICATE_REQUEST_MESSAGE });
  assert.equal(await prisma.order.count(), 1);
  assert.equal(await quantityOf(s.frame.id, s.store.id), 9);

  // A double click: both requests in flight together.
  beforeQuery.fn = async (params) => {
    if (params.model === 'Order' && params.action === 'create') await sleep(150);
  };
  const both = await Promise.all([
    sell(s, 1, { ...credit, requestId: 'pos-credit-0002' }),
    sell(s, 1, { ...credit, requestId: 'pos-credit-0002' }),
  ]);
  beforeQuery.fn = null;
  assert.deepEqual(both.map((r) => r.success), [true, true]);
  assert.deepEqual(both.map((r) => r.message).sort(), ['سفارش با موفقیت ثبت شد.', DUPLICATE_REQUEST_MESSAGE].sort());
  assert.equal(await prisma.order.count(), 2);
  assert.equal(await quantityOf(s.frame.id, s.store.id), 8);
  await assertInvariants();
});

test('a paid checkout sent again after it went through is answered as a duplicate and books nothing more', async () => {
  const s = await shop();
  assert.equal((await sell(s, 1, { requestId: 'pos-paid-00001' })).success, true);
  const before = await snapshot();
  assert.deepEqual(await sell(s, 1, { requestId: 'pos-paid-00001' }), { success: true, message: DUPLICATE_REQUEST_MESSAGE });
  assert.deepEqual(await snapshot(), before);
});

test('two cashiers selling the last frame at the same time: one sale goes through, the other is refused, stock stays at 0', async () => {
  const s = await shop();
  await prisma.inventory.update({ where: { productId_warehouseId: { productId: s.frame.id, warehouseId: s.central.id } }, data: { quantity: 1 } });
  await prisma.inventoryMovement.create({ data: { productId: s.frame.id, fromWarehouseId: s.central.id, quantity: 2, type: 'ADJUSTMENT' } });
  // Both read the stock before either writes.
  beforeQuery.fn = async (params) => {
    if (params.model === 'Order' && params.action === 'create') await sleep(200);
  };
  const results = await Promise.all([
    sell(s, 1, { warehouseId: s.central.id, paidAmount: 0, accountId: '' }),
    sell(s, 1, { warehouseId: s.central.id, paidAmount: 0, accountId: '' }),
  ]);
  beforeQuery.fn = null;
  assert.deepEqual(results.map((r) => r.success).sort(), [false, true]);
  assert.equal(await quantityOf(s.frame.id, s.central.id), 0);
  assert.equal(await prisma.order.count(), 1);
  await assertInvariants();
});

test('only a role holding sales.manage can check out; a refused role writes nothing', async () => {
  const s = await shop();
  const before = await snapshot();
  for (const role of NON_SELLERS) {
    setTestRole(role);
    const result = await sell(s, 1);
    assert.deepEqual([result.success, result.message], [false, DENIED], String(role));
  }
  assert.deepEqual(await snapshot(), before);
  for (const role of SELLERS) {
    setTestRole(role);
    assert.equal((await sell(s, 1)).success, true, role);
  }
  assert.equal(await prisma.order.count(), SELLERS.length);
  await assertInvariants();
});

// --- A sale to a consignment partner at the POS ---

async function partnerWithChannels() {
  const created = await createConsignmentPartner(
    undefined,
    form({
      name: 'همکار',
      [CHANNELS_FIELD]: JSON.stringify([
        { name: 'آنلاین', commissionRate: 30, isDefault: false, isActive: true },
        { name: 'حضوری', commissionRate: 20, isDefault: true, isActive: true },
      ]),
    }),
  );
  assert.equal(created.message, 'همکار امانی با موفقیت ایجاد شد.');
  const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { name: 'انبار امانی - همکار' } });
  return { customerId: warehouse.customerId!, warehouse };
}

test('a POS sale to a partner books its commission through the default channel, on the total after discount, snapshotted', async () => {
  const s = await shop();
  const p = await partnerWithChannels();
  const result = await sell(s, 2, { customerId: p.customerId, discount: 1_000_000, paidAmount: 0, accountId: '' });
  assert.equal(result.success, true, result.message);

  const order = await theOrder();
  const shopChannel = await prisma.consignmentChannel.findFirstOrThrow({ where: { name: 'حضوری' } });
  assert.equal(order.consignmentChannelId, shopChannel.id);
  assert.equal(order.commissions.length, 1);
  const [commission] = order.commissions;
  assert.deepEqual(
    [Number(commission.commissionRate), commission.channelName, Number(commission.orderAmount), Number(commission.commissionAmount), commission.isPaid, commission.customerId],
    [20, 'حضوری', 19_000_000, 3_800_000, false, p.customerId],
  );
  // The order is stored gross; the stock came from the shop, not from the partner's warehouse.
  assert.equal(Number(order.totalAmount), 2 * PRICE);
  assert.equal(order.items[0].warehouseId, s.store.id);

  // Changing the channel's rate later leaves the booked commission as it was.
  const edited = await updateConsignmentPartner(
    p.warehouse.id,
    undefined,
    form({
      name: 'همکار',
      [CHANNELS_FIELD]: JSON.stringify([
        { name: 'آنلاین', commissionRate: 30, isDefault: false, isActive: true },
        { id: shopChannel.id, name: 'حضوری', commissionRate: 50, isDefault: true, isActive: true },
      ]),
    }),
  );
  assert.equal(edited.success, true, edited.message);
  const after = await prisma.consignmentCommission.findFirstOrThrow();
  assert.deepEqual([Number(after.commissionRate), Number(after.commissionAmount)], [20, 3_800_000]);
  await assertInvariants();
});

test('a partner from before channels is charged the rate on the customer; a closed default channel falls to the first open one', async () => {
  const s = await shop();
  const legacy = await prisma.customer.create({ data: { name: 'همکار قدیمی', commissionRate: 10 } });
  await prisma.warehouse.create({ data: { name: 'انبار امانی - همکار قدیمی', isVirtual: true, customerId: legacy.id } });
  assert.equal((await sell(s, 1, { customerId: legacy.id, paidAmount: 0, accountId: '' })).success, true);
  const first = await prisma.consignmentCommission.findFirstOrThrow({ where: { customerId: legacy.id } });
  assert.deepEqual([Number(first.commissionRate), first.channelName, Number(first.commissionAmount)], [10, null, 1_000_000]);

  const p = await partnerWithChannels();
  await prisma.consignmentChannel.updateMany({ where: { name: 'حضوری' }, data: { isActive: false } });
  assert.equal((await sell(s, 1, { customerId: p.customerId, paidAmount: 0, accountId: '' })).success, true);
  const second = await prisma.consignmentCommission.findFirstOrThrow({ where: { customerId: p.customerId } });
  assert.deepEqual([Number(second.commissionRate), second.channelName], [30, 'آنلاین']);

  // An ordinary customer is charged no commission at all.
  assert.equal((await sell(s, 1, { paidAmount: 0, accountId: '' })).success, true);
  assert.equal(await prisma.consignmentCommission.count(), 2);
});
