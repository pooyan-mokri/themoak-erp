import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { prisma, resetDatabase } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { AccessDenied } from '@/lib/access';
import {
  adjustStock,
  getInventoryByProduct,
  getInventoryByWarehouse,
  getWarehouseDashboardStats,
  transferStock,
  transferStockBatch,
  updateStock,
} from '@/actions/inventory';
import { assertStockInvariants, qty, stockSnapshot, stockUp } from './stock';

// Adjustments, transfers and stock reads: every change books its movement, nothing goes below zero,
// and a refusal writes nothing.

console.error = () => {};

const DENIED = 'شما به این بخش دسترسی ندارید.';
const COST = 700_000;
const SELL = 2_000_000;

let w: { main: string; shop: string; archived: string; partner: string };
let p: { panj: string; yek: string };

beforeEach(async () => {
  setTestRole('ADMIN');
  beforeQuery.fn = null;
  await resetDatabase();
  const customer = await prisma.customer.create({ data: { name: 'عینک‌فروشی شریک' } });
  w = {
    main: (await prisma.warehouse.create({ data: { name: 'مرکزی' } })).id,
    shop: (await prisma.warehouse.create({ data: { name: 'فروشگاه' } })).id,
    archived: (await prisma.warehouse.create({ data: { name: 'قدیمی', isArchived: true, archivedAt: new Date() } })).id,
    partner: (await prisma.warehouse.create({ data: { name: 'امانی شریک', isVirtual: true, customerId: customer.id } })).id,
  };
  p = {
    panj: (await prisma.product.create({ data: { name: 'PANJ - Blue', sku: 'PANJ/BLUE', costPrice: COST, sellPrice: SELL } })).id,
    yek: (await prisma.product.create({ data: { name: 'YEK - Black', sku: 'YEK/BLK', costPrice: 400_000, sellPrice: 1_500_000 } })).id,
  };
  await stockUp(p.panj, w.main, 5);
  await stockUp(p.yek, w.main, 3);
});
after(() => prisma.$disconnect());

/** Runs `first`, and starts `second` right before `first` takes stock, giving `second` the chance to finish first. */
async function overlapping<T>(first: () => Promise<T>, second: () => Promise<T>): Promise<[T, T]> {
  let started: Promise<T> | null = null;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Inventory' || params.action !== 'updateMany') return;
    beforeQuery.fn = null;
    started = second();
    await Promise.race([started, sleep(500)]);
  };
  const a = await first();
  beforeQuery.fn = null;
  assert.ok(started, 'the second call was started');
  return [a, await started!];
}

// --- adjustStock ---

test('adjustStock: an increase and a decrease each move the stock and book one ADJUSTMENT movement', async () => {
  const up = await adjustStock(p.panj, w.main, 4, undefined, 'REF-1', ['ورودی فصلی']);
  assert.deepEqual(up, { success: true, message: 'موجودی با موفقیت تنظیم شد.' });
  const down = await adjustStock(p.panj, w.main, -6);
  assert.equal(down.success, true);
  assert.equal(await qty(p.panj, w.main), 3);

  const movements = await prisma.inventoryMovement.findMany({ where: { note: { not: 'موجودی اولیه' } }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(
    movements.map((m: any) => [m.type, m.fromWarehouseId, m.toWarehouseId, m.quantity, m.note, m.referenceId, m.tags]),
    [
      ['ADJUSTMENT', null, w.main, 4, 'افزایش موجودی', 'REF-1', ['ورودی فصلی']],
      ['ADJUSTMENT', w.main, null, 6, 'کاهش موجودی', null, []],
    ],
  );
  await assertStockInvariants();
});

test('adjustStock: an increase in a warehouse without a row creates it; a custom note is kept', async () => {
  const result = await adjustStock(p.yek, w.shop, 2, 'پیدا شد در انبار');
  assert.equal(result.success, true);
  assert.equal(await qty(p.yek, w.shop), 2);
  assert.equal((await prisma.inventoryMovement.findFirstOrThrow({ where: { toWarehouseId: w.shop } })).note, 'پیدا شد در انبار');
  await assertStockInvariants();
});

test('adjustStock: a decrease below zero, zero, fractions, NaN and infinity are refused and write nothing', async () => {
  const before = await stockSnapshot();
  const cases: Array<[number, RegExp]> = [
    [-6, /کافی نیست/],
    [0, /غیر صفر/],
    [1.5, /عدد صحیح/],
    [-0.5, /عدد صحیح/],
    [Number.NaN, /عدد صحیح/],
    [Number.POSITIVE_INFINITY, /عدد صحیح/],
  ];
  for (const [amount, message] of cases) {
    const result = await adjustStock(p.panj, w.main, amount);
    assert.equal(result.success, false, String(amount));
    assert.match((result as any).error, message, String(amount));
  }
  // A decrease where the product has no row at all.
  assert.match(((await adjustStock(p.panj, w.shop, -1)) as any).error, /کافی نیست/);
  assert.deepEqual(await stockSnapshot(), before);

  // Very large but whole: accepted, exactly.
  assert.equal((await adjustStock(p.panj, w.main, 1_000_000)).success, true);
  assert.equal(await qty(p.panj, w.main), 1_000_005);
  await assertStockInvariants();
});

test('adjustStock: an archived or unknown warehouse and an unknown product are refused in Persian, and nothing is written', async () => {
  const before = await stockSnapshot();
  assert.match(((await adjustStock(p.panj, w.archived, 1)) as any).error, /آرشیو/);
  assert.match(((await adjustStock(p.panj, 'no-such-warehouse', 1)) as any).error, /انبار یافت نشد/);
  const unknown = (await adjustStock('no-such-product', w.main, 1)) as any;
  assert.equal(unknown.success, false);
  assert.equal(unknown.error, 'خطا در تنظیم موجودی.');
  assert.deepEqual(await stockSnapshot(), before);
});

test('adjustStock: a consignment partner warehouse is a live warehouse and can be adjusted', async () => {
  assert.equal((await adjustStock(p.panj, w.partner, 2)).success, true);
  assert.equal(await qty(p.panj, w.partner), 2);
  await assertStockInvariants();
});

test('adjustStock: two decreases of the whole stock at once, exactly one goes through', async () => {
  const [a, b] = await overlapping(
    () => adjustStock(p.panj, w.main, -5),
    () => adjustStock(p.panj, w.main, -5),
  );
  assert.deepEqual([a.success, b.success].sort(), [false, true]);
  assert.equal(await qty(p.panj, w.main), 0);
  await assertStockInvariants();
});

// --- transferStock ---

test('transferStock: moves the units, books one TRANSFER with note, reference and tags', async () => {
  const result = await transferStock(p.panj, w.main, w.shop, 2, 'برای ویترین', 'REF-9', ['ویترین']);
  assert.deepEqual(result, { success: true, message: 'جابجایی موجودی با موفقیت انجام شد' });
  assert.deepEqual([await qty(p.panj, w.main), await qty(p.panj, w.shop)], [3, 2]);
  const movement = await prisma.inventoryMovement.findFirstOrThrow({ where: { type: 'TRANSFER' } });
  assert.deepEqual(
    [movement.fromWarehouseId, movement.toWarehouseId, movement.quantity, movement.note, movement.referenceId, movement.tags],
    [w.main, w.shop, 2, 'برای ویترین', 'REF-9', ['ویترین']],
  );
  // The whole remaining stock can go too, leaving a zero row.
  assert.equal((await transferStock(p.panj, w.main, w.partner, 3)).success, true);
  assert.deepEqual([await qty(p.panj, w.main), await qty(p.panj, w.partner)], [0, 3]);
  await assertStockInvariants();
});

test('transferStock: more than the source holds, a source without a row, a negative, zero or fractional quantity, and the same warehouse are refused', async () => {
  const before = await stockSnapshot();
  const cases: Array<[() => Promise<any>, RegExp]> = [
    [() => transferStock(p.panj, w.main, w.shop, 6), /موجودی انبار مبدا کافی نیست/],
    [() => transferStock(p.panj, w.shop, w.main, 1), /موجودی انبار مبدا کافی نیست/],
    // A negative quantity used to pass the stock check and move stock backwards, into the negative.
    [() => transferStock(p.panj, w.main, w.shop, -3), /عدد صحیح و بزرگ‌تر از صفر/],
    [() => transferStock(p.panj, w.main, w.shop, 0), /عدد صحیح و بزرگ‌تر از صفر/],
    [() => transferStock(p.panj, w.main, w.shop, 1.5), /عدد صحیح و بزرگ‌تر از صفر/],
    [() => transferStock(p.panj, w.main, w.main, 1), /یکسان/],
    [() => transferStock(p.panj, w.main, w.archived, 1), /آرشیو/],
    [() => transferStock(p.panj, w.main, 'nowhere', 1), /انبار یافت نشد/],
  ];
  for (const [call, message] of cases) {
    const result = await call();
    assert.equal(result.success, false);
    assert.match(result.error, message);
    assert.doesNotMatch(result.error, /prisma|constraint|invocation/i);
  }
  assert.deepEqual(await stockSnapshot(), before);
});

test('transferStock: two transfers of the whole stock at once, exactly one goes through and the source never goes negative', async () => {
  const [a, b] = await overlapping(
    () => transferStock(p.panj, w.main, w.shop, 5),
    () => transferStock(p.panj, w.main, w.partner, 5),
  );
  assert.deepEqual([a.success, b.success].sort(), [false, true]);
  assert.equal(await qty(p.panj, w.main), 0);
  assert.equal(((await qty(p.panj, w.shop)) ?? 0) + ((await qty(p.panj, w.partner)) ?? 0), 5);
  await assertStockInvariants();
});

// --- transferStockBatch ---

test('transferStockBatch: every line moves with its own movement; lines of zero or less are ignored', async () => {
  const result = await transferStockBatch({
    fromWarehouseId: w.main,
    toWarehouseId: w.shop,
    items: [
      { productId: p.panj, quantity: 2 },
      { productId: p.yek, quantity: 3 },
      { productId: p.yek, quantity: 0 },
      { productId: p.panj, quantity: -4 },
    ],
    tags: ['انتقال هفتگی'],
    note: 'ارسال به فروشگاه',
  });
  assert.deepEqual(result, { success: true, message: 'جابجایی 2 کالا با موفقیت انجام شد' });
  assert.deepEqual(
    [await qty(p.panj, w.main), await qty(p.panj, w.shop), await qty(p.yek, w.main), await qty(p.yek, w.shop)],
    [3, 2, 0, 3],
  );
  const movements = await prisma.inventoryMovement.findMany({ where: { type: 'TRANSFER' } });
  assert.equal(movements.length, 2);
  assert.ok(movements.every((m: any) => m.note === 'ارسال به فروشگاه' && m.tags[0] === 'انتقال هفتگی'));
  await assertStockInvariants();
});

test('transferStockBatch: the same product on two lines is taken twice, and refused once the stock runs out', async () => {
  const ok = await transferStockBatch({
    fromWarehouseId: w.main,
    toWarehouseId: w.shop,
    items: [{ productId: p.panj, quantity: 3 }, { productId: p.panj, quantity: 2 }],
  });
  assert.equal(ok.success, true);
  assert.deepEqual([await qty(p.panj, w.main), await qty(p.panj, w.shop)], [0, 5]);
  await stockUp(p.panj, w.main, 4);
  const before = await stockSnapshot();
  const refused = await transferStockBatch({
    fromWarehouseId: w.main,
    toWarehouseId: w.shop,
    items: [{ productId: p.panj, quantity: 3 }, { productId: p.panj, quantity: 2 }],
  });
  assert.equal(refused.success, false);
  assert.match((refused as any).error, /«PANJ - Blue»/);
  assert.deepEqual(await stockSnapshot(), before);
  await assertStockInvariants();
});

test('transferStockBatch: a short line rolls back the lines before it', async () => {
  const before = await stockSnapshot();
  const result = await transferStockBatch({
    fromWarehouseId: w.main,
    toWarehouseId: w.shop,
    items: [{ productId: p.panj, quantity: 5 }, { productId: p.yek, quantity: 4 }],
  });
  assert.equal(result.success, false);
  assert.equal((result as any).error, 'موجودی انبار مبدا برای «YEK - Black» کافی نیست');
  assert.deepEqual(await stockSnapshot(), before);
});

test('transferStockBatch: missing or equal warehouses, no lines, fractions and archived warehouses are refused', async () => {
  const before = await stockSnapshot();
  const line = [{ productId: p.panj, quantity: 1 }];
  const cases: Array<[any, RegExp]> = [
    [{ fromWarehouseId: '', toWarehouseId: w.shop, items: line }, /انتخاب کنید/],
    [{ fromWarehouseId: w.main, toWarehouseId: w.main, items: line }, /یکسان/],
    [{ fromWarehouseId: w.main, toWarehouseId: w.shop, items: [] }, /حداقل یک کالا/],
    [{ fromWarehouseId: w.main, toWarehouseId: w.shop, items: [{ productId: '', quantity: 1 }] }, /حداقل یک کالا/],
    [{ fromWarehouseId: w.main, toWarehouseId: w.shop, items: [{ productId: p.panj, quantity: 0.5 }] }, /عدد صحیح/],
    [{ fromWarehouseId: w.archived, toWarehouseId: w.shop, items: line }, /آرشیو/],
    [{ fromWarehouseId: w.main, toWarehouseId: w.archived, items: line }, /آرشیو/],
  ];
  for (const [input, message] of cases) {
    const result = (await transferStockBatch(input)) as any;
    assert.equal(result.success, false);
    assert.match(result.error, message);
  }
  assert.deepEqual(await stockSnapshot(), before);
});

test('transferStockBatch: two batches taking the same stock at once, exactly one goes through', async () => {
  const batch = () =>
    transferStockBatch({ fromWarehouseId: w.main, toWarehouseId: w.shop, items: [{ productId: p.panj, quantity: 4 }] });
  const [a, b] = await overlapping(batch, batch);
  assert.deepEqual([a.success, b.success].sort(), [false, true]);
  assert.deepEqual([await qty(p.panj, w.main), await qty(p.panj, w.shop)], [1, 4]);
  await assertStockInvariants();
});

// --- updateStock ---

test('updateStock: setting a counted quantity books the difference as a movement; the same number books nothing', async () => {
  assert.equal((await updateStock(p.panj, w.main, 8)).success, true);
  assert.equal((await updateStock(p.panj, w.main, 2)).success, true);
  assert.equal((await updateStock(p.panj, w.main, 2)).success, true);
  assert.equal((await updateStock(p.yek, w.shop, 4)).success, true);
  assert.deepEqual([await qty(p.panj, w.main), await qty(p.yek, w.shop)], [2, 4]);
  const booked = await prisma.inventoryMovement.findMany({ where: { note: { not: 'موجودی اولیه' } }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(
    booked.map((m: any) => [m.fromWarehouseId, m.toWarehouseId, m.quantity]),
    [[null, w.main, 3], [w.main, null, 6], [null, w.shop, 4]],
  );
  await assertStockInvariants();
});

test('updateStock: a negative or fractional quantity and an archived warehouse are refused', async () => {
  const before = await stockSnapshot();
  assert.match(((await updateStock(p.panj, w.main, -1)) as any).error, /بزرگ‌تر یا برابر صفر/);
  assert.match(((await updateStock(p.panj, w.main, 2.5)) as any).error, /عدد صحیح/);
  assert.match(((await updateStock(p.panj, w.archived, 1)) as any).error, /آرشیو/);
  assert.deepEqual(await stockSnapshot(), before);
});

// --- roles ---

test('every stock write refuses each role without stock.manage and writes nothing; WAREHOUSE and ADMIN may write', async () => {
  const before = await stockSnapshot();
  for (const role of ['AUDITOR', 'ACCOUNTANT', 'SALES', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    for (const result of [
      await updateStock(p.panj, w.main, 9),
      await adjustStock(p.panj, w.main, 1),
      await transferStock(p.panj, w.main, w.shop, 1),
      await transferStockBatch({ fromWarehouseId: w.main, toWarehouseId: w.shop, items: [{ productId: p.panj, quantity: 1 }] }),
    ]) {
      assert.equal(result.success, false, String(role));
      assert.equal((result as any).message, DENIED, String(role));
    }
  }
  assert.deepEqual(await stockSnapshot(), before);
  for (const role of ['WAREHOUSE', 'ADMIN']) {
    setTestRole(role);
    assert.equal((await adjustStock(p.panj, w.main, 1)).success, true, String(role));
    assert.equal((await transferStock(p.panj, w.main, w.shop, 1)).success, true, String(role));
  }
  await assertStockInvariants();
});

// --- reads ---

test('getInventoryByProduct lists every warehouse row with its warehouse; needs stock.view', async () => {
  await stockUp(p.panj, w.partner, 2);
  setTestRole('SALES');
  const rows = await getInventoryByProduct(p.panj);
  assert.deepEqual(
    rows.map((r: any) => [r.warehouse.name, r.quantity, r.warehouse.customerId === undefined]).sort(),
    [['امانی شریک', 2, false], ['مرکزی', 5, true]],
  );
  for (const role of ['PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    await assert.rejects(getInventoryByProduct(p.panj), AccessDenied);
  }
});

test('getInventoryByWarehouse: sorted by name; cost only with cost.view, sell price only with sales.view', async () => {
  const expectations: Array<[string, boolean, boolean]> = [
    ['ADMIN', true, true],
    ['AUDITOR', true, true],
    ['ACCOUNTANT', false, true],
    ['SALES', false, true],
    ['WAREHOUSE', false, false],
  ];
  for (const [role, cost, sell] of expectations) {
    setTestRole(role);
    const rows = await getInventoryByWarehouse(w.main);
    assert.deepEqual(rows.map((r: any) => r.product.name), ['PANJ - Blue', 'YEK - Black'], role);
    assert.equal('costPrice' in rows[0].product, cost, role);
    assert.equal('sellPrice' in rows[0].product, sell, role);
    if (cost) assert.equal(rows[0].product.costPrice, COST);
    if (sell) assert.equal(rows[0].product.sellPrice, SELL);
  }
  setTestRole('USER');
  await assert.rejects(getInventoryByWarehouse(w.main), AccessDenied);
});

test('getWarehouseDashboardStats: live warehouses, products, rows at or under 10, and stock value at cost for cost viewers', async () => {
  await stockUp(p.yek, w.partner, 20);
  const stats = await getWarehouseDashboardStats();
  // Archived warehouses are hidden everywhere, so the count leaves them out.
  assert.deepEqual(stats, {
    totalWarehouses: 3,
    totalProducts: 2,
    lowStockItems: 2,
    totalValue: 5 * COST + 23 * 400_000,
  });
  for (const role of ['WAREHOUSE', 'SALES', 'ACCOUNTANT']) {
    setTestRole(role);
    assert.equal((await getWarehouseDashboardStats()).totalValue, null, role);
  }
  setTestRole('AUDITOR');
  assert.equal((await getWarehouseDashboardStats()).totalValue, 5 * COST + 23 * 400_000);
  setTestRole(null);
  await assert.rejects(getWarehouseDashboardStats(), AccessDenied);
});
