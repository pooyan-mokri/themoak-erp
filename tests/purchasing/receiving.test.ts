import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { prisma, resetDatabase } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { receivePurchaseOrder, receivePurchaseOrderItems } from '@/actions/supplier';
import { recordArrival } from '@/actions/supplier-workflow';
import { getAssets } from '@/actions/fixed-assets';
import { assertStockInvariants, qty, stockSnapshot } from '../inventory/stock';
import { USD_RATE, assertPurchaseInvariants, order, purchasingWorld, type World } from './world';

// Receiving purchase orders into a warehouse: stock with PURCHASE movements, received quantities and
// status, the landed cost rolled into the product's cost exactly once, consumables and fixed assets.

console.error = () => {};

const DENIED = 'شما به این بخش دسترسی ندارید.';
let w: World;

beforeEach(async () => {
  setTestRole('ADMIN');
  beforeQuery.fn = null;
  await resetDatabase();
  w = await purchasingWorld();
});
after(() => prisma.$disconnect());

const costOf = async (id: string) => Number((await prisma.product.findUniqueOrThrow({ where: { id } })).costPrice);
const item = (id: string) => prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id } });
const statusOf = async (id: string) => (await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } })).status;

/** 10 PANJ at 100,000 plus 200,000 of costs (half on the order, half on arrival): 120,000 landed each. */
async function arrivedPanj() {
  const po = await order(w, [{ productId: w.panj.id, quantity: 10, unitCost: 100_000 }], [{ title: 'حمل', amount: 100_000, currency: 'TOMAN' }], 'IN_PRODUCTION');
  assert.equal((await recordArrival(po.id, [{ title: 'ترخیص', amount: 100_000, currency: 'TOMAN' }], 'toman')).success, true);
  return po;
}

test('a partial then a full receipt: stock, PURCHASE movements, received quantities, dates and status', async () => {
  const po = await arrivedPanj();
  const first = await receivePurchaseOrderItems(po.id, w.main.id, [{ itemId: po.items[0].id, receivedQuantity: 4 }]);
  assert.deepEqual(first, { success: true, message: 'کالاها با موفقیت دریافت و به موجودی اضافه شدند' });
  assert.equal(await statusOf(po.id), 'PARTIALLY_RECEIVED');
  let line = await item(po.items[0].id);
  assert.equal(line.receivedQuantity, 4);
  assert.ok(line.receivedDate);
  assert.equal(await qty(w.panj.id, w.main.id), 9);

  // The rest goes to the shop, after a partial receipt (the page used to hide the receive button here).
  assert.equal((await receivePurchaseOrderItems(po.id, w.shop.id, [{ itemId: po.items[0].id, receivedQuantity: 6 }])).success, true);
  assert.equal(await statusOf(po.id), 'RECEIVED');
  line = await item(po.items[0].id);
  assert.equal(line.receivedQuantity, 10);
  assert.equal(await qty(w.panj.id, w.shop.id), 6);
  const movements = await prisma.inventoryMovement.findMany({ where: { type: 'PURCHASE' }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(
    movements.map((m: any) => [m.toWarehouseId, m.fromWarehouseId, m.quantity, m.referenceId, m.note]),
    [
      [w.main.id, null, 4, po.id, `دریافت سفارش خرید #${po.number}`],
      [w.shop.id, null, 6, po.id, `دریافت سفارش خرید #${po.number}`],
    ],
  );
  await assertStockInvariants();
  await assertPurchaseInvariants();
});

test('a partly received order takes the rest in later receipts, each adding only its own units, never more than remain', async () => {
  const po = await arrivedPanj();
  const receive = (quantity: number) => receivePurchaseOrderItems(po.id, w.shop.id, [{ itemId: po.items[0].id, receivedQuantity: quantity }]);
  assert.equal((await receive(3)).success, true);
  assert.equal(await statusOf(po.id), 'PARTIALLY_RECEIVED');
  // 3 in, 7 remain: 8 more is refused whole.
  const over = await receive(8);
  assert.equal(over.success, false);
  assert.match(over.error!, /بیشتر از تعداد سفارش/);
  assert.equal((await receive(3)).success, true);
  assert.deepEqual([(await item(po.items[0].id)).receivedQuantity, await qty(w.panj.id, w.shop.id), await statusOf(po.id)], [6, 6, 'PARTIALLY_RECEIVED']);
  assert.equal((await receive(4)).success, true);
  assert.deepEqual([(await item(po.items[0].id)).receivedQuantity, await qty(w.panj.id, w.shop.id), await statusOf(po.id)], [10, 10, 'RECEIVED']);
  // Received in full: nothing more comes in, and the whole-order receive has nothing left to add.
  assert.equal((await receive(1)).success, false);
  assert.equal((await receivePurchaseOrder(po.id, w.shop.id)).success, false);
  const movements = await prisma.inventoryMovement.findMany({ where: { type: 'PURCHASE', referenceId: po.id }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(movements.map((m: any) => m.quantity), [3, 3, 4]);
  assert.equal(await qty(w.panj.id, w.shop.id), 10);
  await assertStockInvariants();
  await assertPurchaseInvariants();
});

test('cost of record: a weighted average of the stock on hand and the landed cost, which is counted once over all receipts', async () => {
  // 5 on hand at 300,000.
  const po = await arrivedPanj();
  await receivePurchaseOrderItems(po.id, w.main.id, [{ itemId: po.items[0].id, receivedQuantity: 4 }]);
  // (5 × 300,000 + 4 × 120,000) / 9
  assert.equal(await costOf(w.panj.id), 220_000);
  await receivePurchaseOrderItems(po.id, w.main.id, [{ itemId: po.items[0].id, receivedQuantity: 6 }]);
  // (9 × 220,000 + 6 × 120,000) / 15
  assert.equal(await costOf(w.panj.id), 180_000);
  // The line's received cost is its value plus the whole additional-cost pool: 1,000,000 + 200,000, once.
  assert.equal(Number((await item(po.items[0].id)).totalCostInToman), 1_200_000);
});

test('landed cost: the pool is shared by value across lines, and each line carries exactly its share', async () => {
  const po = await order(w, [
    { productId: w.yek.id, quantity: 10, unitCost: 100_000 },
    { productId: w.other.id, quantity: 5, unitCost: 400_000 },
  ], [{ title: 'حمل', amount: 100_000, currency: 'TOMAN' }], 'IN_PRODUCTION');
  await recordArrival(po.id, [{ title: 'گمرک', amount: 200_000, currency: 'TOMAN' }], 'toman');
  const result = await receivePurchaseOrderItems(po.id, w.main.id, [
    { itemId: po.items[0].id, receivedQuantity: 10 },
    { itemId: po.items[1].id, receivedQuantity: 5 },
  ]);
  assert.equal(result.success, true, result.error);
  // 300,000 × 100,000 / 3,000,000 = 10,000 a frame; 300,000 × 400,000 / 3,000,000 = 40,000 a strap.
  assert.deepEqual([await costOf(w.yek.id), await costOf(w.other.id)], [110_000, 440_000]);
  const lines = await Promise.all(po.items.map((i: any) => item(i.id)));
  const received = lines.reduce((s: number, l: any) => s + Number(l.totalCostInToman), 0);
  assert.equal(received, 3_000_000 + 300_000);
  // OTHER goods are stock too; a product without a cost takes the landed cost as it is.
  assert.deepEqual([await qty(w.yek.id, w.main.id), await qty(w.other.id, w.main.id)], [10, 5]);
  assert.equal(await statusOf(po.id), 'RECEIVED');
  await assertStockInvariants();
});

test('a dollar order is costed at its rate snapshot, not at the rate on the day it is received', async () => {
  const po = await order(w, [{ productId: w.yek.id, quantity: 10, unitCost: 50, currency: 'USD' }], [{ title: 'حمل', amount: 20, currency: 'USD' }], 'ARRIVED');
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 150_000, date: new Date('2026-09-25') } });
  assert.equal((await receivePurchaseOrderItems(po.id, w.main.id, [{ itemId: po.items[0].id, receivedQuantity: 10 }])).success, true);
  assert.equal(await costOf(w.yek.id), 50 * USD_RATE + 2 * USD_RATE);
  assert.equal(Number((await item(po.items[0].id)).totalCostInToman), 520 * USD_RATE);
});

test('the same product on two lines, or the same line twice in one call, is costed and counted right', async () => {
  const po = await order(w, [
    { productId: w.panj.id, quantity: 5, unitCost: 100_000 },
    { productId: w.panj.id, quantity: 5, unitCost: 200_000 },
  ], [], 'ARRIVED');
  const result = await receivePurchaseOrderItems(po.id, w.main.id, [
    { itemId: po.items[0].id, receivedQuantity: 3 },
    { itemId: po.items[0].id, receivedQuantity: 2 },
    { itemId: po.items[1].id, receivedQuantity: 5 },
  ]);
  assert.equal(result.success, true, result.error);
  assert.deepEqual([(await item(po.items[0].id)).receivedQuantity, (await item(po.items[1].id)).receivedQuantity], [5, 5]);
  assert.equal(await qty(w.panj.id, w.main.id), 15);
  // (5 × 300,000 + 5 × 100,000) / 10 = 200,000, then (10 × 200,000 + 5 × 200,000) / 15 = 200,000.
  assert.equal(await costOf(w.panj.id), 200_000);
  assert.equal(await statusOf(po.id), 'RECEIVED');

  // Twice the same line past its quantity is refused whole.
  const po2 = await order(w, [{ productId: w.panj.id, quantity: 10, unitCost: 100_000 }], [], 'ARRIVED');
  const before = await stockSnapshot();
  const over = await receivePurchaseOrderItems(po2.id, w.main.id, [
    { itemId: po2.items[0].id, receivedQuantity: 6 },
    { itemId: po2.items[0].id, receivedQuantity: 6 },
  ]);
  assert.equal(over.success, false);
  assert.match(over.error!, /بیشتر از تعداد سفارش/);
  assert.deepEqual(await stockSnapshot(), before);
  await assertStockInvariants();
});

test('receiving one line of two in full leaves the order PARTIALLY_RECEIVED until the other comes in', async () => {
  const po = await order(w, [
    { productId: w.panj.id, quantity: 2, unitCost: 100_000 },
    { productId: w.yek.id, quantity: 3, unitCost: 100_000 },
  ], [], 'ARRIVED');
  await receivePurchaseOrderItems(po.id, w.main.id, [{ itemId: po.items[0].id, receivedQuantity: 2 }]);
  assert.equal(await statusOf(po.id), 'PARTIALLY_RECEIVED');
  await receivePurchaseOrderItems(po.id, w.main.id, [{ itemId: po.items[1].id, receivedQuantity: 3 }]);
  assert.equal(await statusOf(po.id), 'RECEIVED');
});

test('refusals write nothing: over the ordered quantity, zero, negative or fractional units, a line of another order', async () => {
  const po = await arrivedPanj();
  const otherPo = await order(w, [{ productId: w.yek.id, quantity: 1, unitCost: 1 }], [], 'ARRIVED');
  const before = await stockSnapshot();
  const cases: Array<[any[], RegExp]> = [
    [[{ itemId: po.items[0].id, receivedQuantity: 11 }], /بیشتر از تعداد سفارش/],
    [[{ itemId: po.items[0].id, receivedQuantity: 0 }], /عدد صحیح و بزرگ‌تر از صفر/],
    [[{ itemId: po.items[0].id, receivedQuantity: -3 }], /عدد صحیح و بزرگ‌تر از صفر/],
    [[{ itemId: po.items[0].id, receivedQuantity: 1.5 }], /عدد صحیح و بزرگ‌تر از صفر/],
    [[{ itemId: otherPo.items[0].id, receivedQuantity: 1 }], /جزو این سفارش نیست/],
    [[], /حداقل یک آیتم/],
  ];
  for (const [lines, message] of cases) {
    const result = await receivePurchaseOrderItems(po.id, w.main.id, lines);
    assert.equal(result.success, false, JSON.stringify(lines));
    assert.match(result.error!, message, JSON.stringify(lines));
  }
  assert.deepEqual(await stockSnapshot(), before);
  assert.equal((await item(po.items[0].id)).receivedQuantity, 0);
  assert.equal(await costOf(w.panj.id), 300_000);
  assert.equal(await statusOf(po.id), 'ARRIVED');
});

test('refusals write nothing: an order that has not arrived, is cancelled or received; an archived, virtual or unknown warehouse', async () => {
  const line = (po: any) => [{ itemId: po.items[0].id, receivedQuantity: 1 }];
  const before = await stockSnapshot();
  for (const status of ['DRAFT', 'PENDING_PAYMENT', 'PARTIALLY_PAID', 'PAID', 'IN_PRODUCTION', 'CANCELLED', 'RECEIVED']) {
    const po = await order(w, [{ productId: w.panj.id, quantity: 2, unitCost: 1 }], [], status);
    const result = await receivePurchaseOrderItems(po.id, w.main.id, line(po));
    assert.equal(result.success, false, status);
    assert.match(result.error!, /در وضعیت دریافت کالا نیست/, status);
  }
  const po = await order(w, [{ productId: w.panj.id, quantity: 2, unitCost: 1 }], [], 'ARRIVED');
  for (const warehouseId of [w.archived.id, w.partner.id, 'nowhere']) {
    const result = await receivePurchaseOrderItems(po.id, warehouseId, line(po));
    assert.deepEqual(result, { success: false, error: 'انبار دریافت باید یک انبار فیزیکی و فعال باشد.' });
  }
  assert.deepEqual(await receivePurchaseOrderItems('missing', w.main.id, [{ itemId: 'x', receivedQuantity: 1 }]), { success: false, error: 'سفارش یافت نشد' });
  assert.deepEqual(await stockSnapshot(), before);
  assert.equal(await costOf(w.panj.id), 300_000);
});

test('two receipts of the whole order at once put it into stock once', async () => {
  const po = await arrivedPanj();
  let started: Promise<any> | null = null;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Inventory' || params.action !== 'upsert') return;
    beforeQuery.fn = null;
    started = receivePurchaseOrderItems(po.id, w.main.id, [{ itemId: po.items[0].id, receivedQuantity: 10 }]);
    await Promise.race([started, sleep(500)]);
  };
  const first = await receivePurchaseOrderItems(po.id, w.main.id, [{ itemId: po.items[0].id, receivedQuantity: 10 }]);
  beforeQuery.fn = null;
  const second = await started!;
  assert.deepEqual([first.success, second.success].sort(), [false, true]);
  assert.equal(await qty(w.panj.id, w.main.id), 15);
  assert.equal((await item(po.items[0].id)).receivedQuantity, 10);
  // (5 × 300,000 + 10 × 120,000) / 15 = 180,000, once.
  assert.equal(await costOf(w.panj.id), 180_000);
  await assertStockInvariants();
  await assertPurchaseInvariants();
});

test('consumables go to fixed assets, not stock: one asset per product, its quantity growing with each receipt', async () => {
  const po = await order(w, [{ productId: w.cloth.id, quantity: 100, unitCost: 50_000 }], [], 'ARRIVED');
  await receivePurchaseOrderItems(po.id, w.main.id, [{ itemId: po.items[0].id, receivedQuantity: 60 }]);
  await receivePurchaseOrderItems(po.id, w.main.id, [{ itemId: po.items[0].id, receivedQuantity: 40 }]);
  const assets = await prisma.fixedAsset.findMany();
  assert.deepEqual(
    assets.map((a: any) => [a.name, a.productId, a.assetType, a.quantity, Number(a.purchasePrice), a.usefulLife]),
    [['دستمال', w.cloth.id, 'CONSUMABLE', 100, 50_000, 1]],
  );
  assert.equal(await prisma.inventory.count({ where: { productId: w.cloth.id } }), 0);
  assert.equal(await prisma.inventoryMovement.count({ where: { productId: w.cloth.id } }), 0);
  assert.equal(await statusOf(po.id), 'RECEIVED');
});

test('a later consumable receipt adds to the asset: quantity × unit cost, the unit cost the weighted average', async () => {
  const first = await order(w, [{ productId: w.cloth.id, quantity: 60, unitCost: 50_000 }], [], 'ARRIVED');
  const second = await order(w, [{ productId: w.cloth.id, quantity: 40, unitCost: 60_000 }], [], 'ARRIVED');
  await receivePurchaseOrderItems(first.id, w.main.id, [{ itemId: first.items[0].id, receivedQuantity: 60 }]);
  let asset = await prisma.fixedAsset.findFirstOrThrow({ where: { productId: w.cloth.id } });
  assert.deepEqual([asset.quantity, Number(asset.purchasePrice), Number(asset.currentValue)], [60, 50_000, 3_000_000]);
  const purchaseDate = asset.purchaseDate;
  await receivePurchaseOrderItems(second.id, w.main.id, [{ itemId: second.items[0].id, receivedQuantity: 40 }]);
  asset = await prisma.fixedAsset.findFirstOrThrow({ where: { productId: w.cloth.id } });
  // 60 × 50,000 + 40 × 60,000 = 5,400,000 for 100: 54,000 each. The first 60 are not revalued at 60,000.
  assert.deepEqual([asset.quantity, Number(asset.purchasePrice), Number(asset.currentValue)], [100, 54_000, 5_400_000]);
  assert.equal(asset.purchaseDate.getTime(), purchaseDate.getTime(), 'the asset keeps its first purchase date');
  const [listed] = await getAssets();
  assert.equal(listed.currentValue, 5_400_000);
});

test('fixed assets: one asset per unit, and a second receipt of the same product works too', async () => {
  const po = await order(w, [{ productId: w.lathe.id, quantity: 3, unitCost: 90_000_000 }], [{ title: 'حمل', amount: 3_000_000, currency: 'TOMAN' }], 'ARRIVED');
  assert.equal((await receivePurchaseOrderItems(po.id, w.main.id, [{ itemId: po.items[0].id, receivedQuantity: 2 }])).success, true);
  // productId is unique on FixedAsset: this used to fail with a raw database error.
  const second = await receivePurchaseOrderItems(po.id, w.main.id, [{ itemId: po.items[0].id, receivedQuantity: 1 }]);
  assert.equal(second.success, true, second.error);
  const assets = await prisma.fixedAsset.findMany({ orderBy: { createdAt: 'asc' } });
  assert.deepEqual(
    assets.map((a: any) => [a.name, a.productId, a.assetType, a.quantity, Number(a.purchasePrice), a.usefulLife]),
    [
      ['دستگاه تراش #1', w.lathe.id, 'FIXED', 1, 91_000_000, 5],
      ['دستگاه تراش #2', null, 'FIXED', 1, 91_000_000, 5],
      ['دستگاه تراش', null, 'FIXED', 1, 91_000_000, 5],
    ],
  );
  assert.equal(await prisma.inventory.count({ where: { productId: w.lathe.id } }), 0);
  assert.equal(await statusOf(po.id), 'RECEIVED');
});

test('the old whole-order receive now receives what remains, through the same path', async () => {
  const po = await arrivedPanj();
  await receivePurchaseOrderItems(po.id, w.main.id, [{ itemId: po.items[0].id, receivedQuantity: 4 }]);
  const rest = await receivePurchaseOrder(po.id, w.main.id);
  assert.deepEqual(rest, { success: true, message: 'سفارش با موفقیت دریافت و به موجودی اضافه شد' });
  assert.equal(await qty(w.panj.id, w.main.id), 15);
  assert.equal((await item(po.items[0].id)).receivedQuantity, 10);
  assert.equal(await statusOf(po.id), 'RECEIVED');
  assert.equal(await costOf(w.panj.id), 180_000);
  assert.deepEqual(await receivePurchaseOrder(po.id, w.main.id), { success: false, error: 'این سفارش قبلاً دریافت شده است' });
  assert.deepEqual(await receivePurchaseOrder('missing', w.main.id), { success: false, error: 'سفارش یافت نشد' });
  const draft = await order(w, [{ productId: w.panj.id, quantity: 1, unitCost: 1 }]);
  assert.equal((await receivePurchaseOrder(draft.id, w.main.id)).success, false);
  assert.equal(await qty(w.panj.id, w.main.id), 15);
  await assertStockInvariants();
});

test('receiving takes stock.manage: every other role is refused and nothing is written', async () => {
  const po = await arrivedPanj();
  const before = await stockSnapshot();
  for (const role of ['AUDITOR', 'ACCOUNTANT', 'SALES', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    assert.equal((await receivePurchaseOrderItems(po.id, w.main.id, [{ itemId: po.items[0].id, receivedQuantity: 1 }])).error, DENIED, String(role));
    assert.equal((await receivePurchaseOrder(po.id, w.main.id)).error, DENIED, String(role));
  }
  assert.deepEqual(await stockSnapshot(), before);
  setTestRole('WAREHOUSE');
  assert.equal((await receivePurchaseOrderItems(po.id, w.main.id, [{ itemId: po.items[0].id, receivedQuantity: 1 }])).success, true);
});
