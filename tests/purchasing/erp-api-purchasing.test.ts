// Purchase orders through the ERP API (src/lib/erp-api-purchasing.ts). Pooyan, 2026-10-05: Claude's connector
// records purchase orders for the suppliers in China, in the PI's currency (mostly yuan) with no Toman figure —
// the Toman value is the rate actually paid, decided at payment. Until then the screens and the payables price such
// an order at today's rate, and paying it, receiving it and its landed cost all work.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { GET, POST } from '@/app/api/erp/route';
import { createApiKey } from '@/actions/api-keys';
import { receivePurchaseOrderItems } from '@/actions/supplier';
import { payPurchaseOrderFromCredit, recordPurchasePartialPayment } from '@/actions/supplier-workflow';
import { additionalCostPool, landedCostPerUnit, owedTotalInToman } from '@/lib/landed-cost';
import { foreignTotalOf, purchaseFigures, tomanValueOf } from '@/components/suppliers/purchase-figures';
import { purchasingWorld, type World } from './world';

console.error = () => {};

const FULL = 'owner-full-key-for-purchasing-tests';
const SITE = 'site-key-for-purchasing-tests';
const CNY_RATE = 10_000; // Toman per yuan, in the tests that set one

let w: World;

beforeEach(async () => {
  process.env.ERP_API_SECRET = FULL;
  process.env.ERP_SITE_API_SECRET = SITE;
  setTestRole('ADMIN');
  await resetDatabase();
  await prisma.user.create({ data: { id: 'test-user', name: 'مدیر', email: 'owner@x.test', password: 'x', role: 'ADMIN' } });
  w = await purchasingWorld();
});
after(() => prisma.$disconnect());

const call = (method: 'GET' | 'POST', key: string, query: string, body?: unknown) => {
  const req = new NextRequest(`http://localhost/api/erp?${query}`, {
    method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return method === 'GET' ? GET(req) : POST(req);
};
const get = async (query: string, key = FULL) => {
  const res = await call('GET', key, query);
  return { status: res.status, body: await res.json() };
};
const post = async (body: Record<string, unknown>, key = FULL) => {
  const res = await call('POST', key, '', body);
  return { status: res.status, body: await res.json() };
};
const createPo = (fields: Record<string, unknown>, key = FULL) => post({ action: 'createPurchaseOrder', supplier: 'Mazzucchelli', ...fields }, key);

async function keyFor(name: string, role: string) {
  const user = await prisma.user.create({ data: { name, email: `${role.toLowerCase()}@x.test`, password: 'x', role: role as any } });
  setTestRole('ADMIN');
  const made: any = await createApiKey(user.id, 'Claude');
  assert.equal(made.success, true);
  return { user, key: made.key as string };
}

const order = (number: number) =>
  prisma.purchaseOrder.findFirstOrThrow({ where: { number }, include: { items: { orderBy: { id: 'asc' } }, additionalCosts: true, payments: true } });

test('a yuan order is recorded as the PI states it: no Toman figure, no rate needed, one total in yuan', async () => {
  assert.equal(await prisma.exchangeRate.count({ where: { currency: 'CNY' } }), 0);
  const { status, body } = await createPo({
    supplier: 'mazzu',
    items: [
      { sku: 'panj/blue', quantity: 17, unitCost: 12.5, currency: 'CNY' },
      // 17 paid and 3 free: the same SKU twice, a line at 0.
      { sku: 'PANJ/BLUE', quantity: 3, unitCost: 0, currency: 'CNY' },
      { sku: 'YEK/BLK', quantity: 10, unitCost: '20.1', currency: 'cny' },
    ],
    additionalCosts: [{ title: 'حمل', amount: 300, currency: 'CNY' }],
    tags: ['PI:2026-031', ' نمونه ', 'نمونه'],
  });
  assert.equal(status, 200, JSON.stringify(body));
  const po = body.purchaseOrder;
  assert.equal(po.supplier, 'Mazzucchelli');
  assert.equal(po.status, 'DRAFT');
  assert.equal(po.currency, 'CNY');
  assert.equal(po.totalAmount, 713.5);
  assert.deepEqual(po.totals, { CNY: 713.5 });
  assert.equal(po.totalAmountInToman, null);
  assert.deepEqual(po.tags, ['PI:2026-031', 'نمونه']);
  assert.deepEqual(po.items.map((i: any) => [i.sku, i.quantity, i.unitCost, i.lineTotal]), [
    ['PANJ/BLUE', 17, 12.5, 212.5],
    ['PANJ/BLUE', 3, 0, 0],
    ['YEK/BLK', 10, 20.1, 201],
  ]);

  const row = await order(po.number);
  assert.equal(row.totalAmountInToman, null);
  assert.equal(Number(row.totalAmount), 713.5);
  for (const item of row.items) {
    assert.equal(item.currency, 'CNY');
    assert.deepEqual([item.exchangeRateSnapshot, item.unitCostInToman, item.totalCostInToman], [null, null, null]);
  }
  assert.deepEqual(row.additionalCosts.map((c: any) => [c.title, Number(c.amount), c.currency, c.exchangeRateSnapshot, c.amountInToman]), [['حمل', 300, 'CNY', null, null]]);

  const log = await prisma.activityLog.findFirstOrThrow({ where: { action: 'API_CREATE_PURCHASE_ORDER' } });
  assert.equal(log.userId, null);
  assert.match(log.details, new RegExp(`کلید کامل: سفارش خرید PO-${po.number} از «Mazzucchelli»`));
  assert.match(log.details, /PI:2026-031/);

  // A currency for the whole order covers lines and costs that give none.
  const plain = await createPo({ currency: 'CNY', items: [{ sku: 'STRAP', quantity: 2, unitCost: 4 }], additionalCosts: [{ title: 'بسته‌بندی', amount: 1 }] });
  assert.equal(plain.status, 200, JSON.stringify(plain.body));
  assert.deepEqual(plain.body.purchaseOrder.totals, { CNY: 9 });
});

test('a refused order writes nothing: unknown SKUs are listed, one currency per order, lines, status and supplier checked', async () => {
  const refused = async (fields: Record<string, unknown>, pattern: RegExp) => {
    const { status, body } = await createPo(fields);
    assert.equal(status, 422, JSON.stringify(body));
    assert.match(body.error, pattern);
    return body;
  };
  const line = { sku: 'PANJ/BLUE', quantity: 1, unitCost: 10, currency: 'CNY' };

  const unknown = await refused({ items: [line, { ...line, sku: 'NOPE-1' }, { ...line, sku: 'NOPE-2' }, { ...line, sku: 'nope-1' }] }, /NOPE-1، NOPE-2/);
  assert.deepEqual(unknown.unknownSkus, ['NOPE-1', 'NOPE-2']);
  const mixed = await refused({ items: [line], additionalCosts: [{ title: 'حمل', amount: 5, currency: 'TOMAN' }] }, /یک ارز/);
  assert.deepEqual(mixed.currencies.sort(), ['CNY', 'TOMAN']);
  await refused({ items: [line, { ...line, currency: 'USD' }] }, /یک ارز/);
  await refused({ items: [] }, /items/);
  await refused({ items: [{ ...line, quantity: 0 }] }, /ردیف ۱: تعداد/);
  await refused({ items: [line, { ...line, quantity: 1.5 }] }, /ردیف ۲: تعداد/);
  await refused({ items: [{ ...line, unitCost: -1 }] }, /قیمت واحد/);
  await refused({ items: [{ ...line, unitCost: undefined }] }, /قیمت واحد/);
  await refused({ items: [{ ...line, currency: undefined }] }, /ارز ردیف ۱/);
  await refused({ items: [{ ...line, currency: 'GBP' }] }, /ارز ردیف ۱ باید/);
  await refused({ items: [line], additionalCosts: [{ title: '', amount: 5 }] }, /عنوان/);
  await refused({ items: [line], status: 'PAID' }, /status/);
  await refused({ items: [line], tags: 'PI:1' }, /tags/);
  await refused({ items: [line], supplier: 'کسی نیست' }, /پیدا نشد/);

  // The website's key may not touch purchasing at all.
  assert.equal((await createPo({ items: [line] }, SITE)).status, 403);
  assert.equal((await get('action=purchaseOrders', SITE)).status, 403);
  assert.equal((await get('action=suppliers', SITE)).status, 403);

  assert.equal(await prisma.purchaseOrder.count(), 0);
  assert.equal(await prisma.purchaseOrderItem.count(), 0);
});

test('a PI books once: the same PI is refused, naming the order; a cancelled order frees it; two calls at once book one', async () => {
  const line = [{ sku: 'PANJ/BLUE', quantity: 5, unitCost: 10, currency: 'CNY' }];
  const first = await createPo({ items: line, tags: ['PI:A1'] });
  assert.equal(first.status, 200);
  const again = await createPo({ items: line, tags: ['PI:A1', 'تکرار'] });
  assert.equal(again.status, 422);
  assert.match(again.body.error, new RegExp(`PO-${first.body.purchaseOrder.number}`));
  assert.equal(again.body.existing.number, first.body.purchaseOrder.number);
  // A tag that is not a PI repeats freely.
  assert.equal((await createPo({ items: line, tags: ['PI:A2', 'تکرار'] })).status, 200);
  assert.equal((await createPo({ items: line, tags: ['تکرار'] })).status, 200);

  await prisma.purchaseOrder.update({ where: { id: first.body.purchaseOrder.id }, data: { status: 'CANCELLED' } });
  assert.equal((await createPo({ items: line, tags: ['PI:A1'] })).status, 200);

  const both = await Promise.all([createPo({ items: line, tags: ['PI:B2'] }), createPo({ items: line, tags: ['PI:B2'] })]);
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 422]);
  assert.equal(await prisma.purchaseOrder.count({ where: { tags: { has: 'PI:B2' } } }), 1);
});

test('an order in Toman keeps its Toman figures at rate 1', async () => {
  const { status, body } = await createPo({
    currency: 'TOMAN',
    items: [{ sku: 'PANJ/BLUE', quantity: 2, unitCost: 300_000 }],
    additionalCosts: [{ title: 'حمل', amount: 50_000 }],
  });
  assert.equal(status, 200, JSON.stringify(body));
  const row = await order(body.purchaseOrder.number);
  assert.equal(Number(row.totalAmountInToman), 650_000);
  assert.deepEqual([Number(row.items[0].unitCostInToman), Number(row.items[0].exchangeRateSnapshot)], [300_000, 1]);
  assert.equal(Number(row.additionalCosts[0].amountInToman), 50_000);
});

test('a yuan order is priced at today\'s rate until paid: it lists, pays in part and from credit, and lands with its freight', async () => {
  const { body } = await createPo({
    status: 'PENDING_PAYMENT',
    items: [{ sku: 'PANJ/BLUE', quantity: 10, unitCost: 100, currency: 'CNY' }],
    additionalCosts: [{ title: 'حمل', amount: 200, currency: 'CNY' }],
    tags: ['PI:C3'],
  });
  const po = body.purchaseOrder;
  await prisma.exchangeRate.create({ data: { currency: 'CNY', rateToToman: CNY_RATE, date: new Date('2026-10-01') } });
  const rate = (currency: string) => (currency === 'CNY' ? CNY_RATE : 1);

  // The landed cost carries the yuan freight: 100 yuan + 20 yuan of freight a unit, at today's rate.
  const row = await order(po.number);
  assert.equal(additionalCostPool(row as any, rate), 2_000_000);
  assert.equal(landedCostPerUnit(row.items[0] as any, row as any, rate), 1_200_000);
  assert.equal(owedTotalInToman(row as any, rate), 12_000_000);

  const listed = async () => (await get('action=purchaseOrders&tag=PI:C3')).body.purchaseOrders[0];
  let seen = await listed();
  assert.deepEqual([seen.currency, seen.totalAmount, seen.totalAmountInToman, seen.unpaidInToman], ['CNY', 1200, null, 12_000_000]);
  assert.deepEqual(seen.items, [{ sku: 'PANJ/BLUE', name: 'PANJ - Blue', quantity: 10, unitCost: 100, currency: 'CNY', receivedQuantity: 0 }]);

  setTestRole('ADMIN');
  const partial = await recordPurchasePartialPayment({ orderId: po.id, accountId: 'toman', amount: 5_000_000 });
  assert.equal(partial.success, true, partial.error ?? partial.message);
  seen = await listed();
  assert.deepEqual([seen.status, seen.paidInToman, seen.unpaidInToman], ['PARTIALLY_PAID', 5_000_000, 7_000_000]);

  // The supplier's credit pays the rest (it used to read the missing Toman total as «already settled»).
  await prisma.supplierCredit.create({ data: { supplierId: w.supplier.id, amount: 7_000_000, reason: 'آزمایش' } });
  const fromCredit = await payPurchaseOrderFromCredit({ orderId: po.id });
  assert.equal(fromCredit.success, true, fromCredit.error ?? fromCredit.message);
  seen = await listed();
  assert.deepEqual([seen.paidInToman, seen.unpaidInToman], [12_000_000, 0]);

  // Received: each unit at its landed cost, freight included, averaged into the product's cost.
  await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'ARRIVED' } });
  const received = await receivePurchaseOrderItems(po.id, w.main.id, [{ itemId: row.items[0].id, receivedQuantity: 10 }]);
  assert.equal(received.success, true, received.error);
  const item = await prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: row.items[0].id } });
  assert.equal(Number(item.totalCostInToman), 12_000_000);
  // 5 on hand at 300,000 and 10 at 1,200,000.
  assert.equal(Number((await prisma.product.findUniqueOrThrow({ where: { id: w.panj.id } })).costPrice), 900_000);
});

test('the list filters by supplier, status and tag; suppliers count their orders', async () => {
  const other = await prisma.supplier.create({ data: { name: 'Shenzhen Optical' } });
  const line = [{ sku: 'PANJ/BLUE', quantity: 1, unitCost: 10, currency: 'CNY' }];
  await createPo({ items: line, tags: ['PI:1'] });
  await createPo({ items: line, status: 'PENDING_PAYMENT' });
  await createPo({ supplier: 'shenzhen', items: line });

  const numbers = async (query: string) => (await get(`action=purchaseOrders&${query}`)).body.purchaseOrders.map((o: any) => o.supplier).sort();
  assert.deepEqual(await numbers(''), ['Mazzucchelli', 'Mazzucchelli', 'Shenzhen Optical']);
  assert.deepEqual(await numbers('supplier=shenzhen'), ['Shenzhen Optical']);
  assert.deepEqual(await numbers(`supplier=${other.id}`), ['Shenzhen Optical']);
  assert.deepEqual(await numbers('status=PENDING_PAYMENT'), ['Mazzucchelli']);
  assert.deepEqual(await numbers('tag=PI:1'), ['Mazzucchelli']);
  assert.equal((await get('action=purchaseOrders&status=SHIPPED')).status, 422);
  assert.equal((await get('action=purchaseOrders&limit=1')).body.purchaseOrders.length, 1);

  const suppliers = (await get('action=suppliers')).body;
  assert.deepEqual(suppliers.map((s: any) => [s.name, s.purchaseOrders]), [['Mazzucchelli', 2], ['Shenzhen Optical', 1]]);
});

test('createSupplier refuses a name already there, case and spaces aside; createProduct makes a product the site does not sell', async () => {
  const made = await post({ action: 'createSupplier', name: 'Acme Optics', phone: '+86 755 1234', email: 'sales@acme.cn', address: 'Shenzhen' });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const again = await post({ action: 'createSupplier', name: '  acme OPTICS ' });
  assert.equal(again.status, 422);
  assert.equal(again.body.supplier.id, made.body.supplier.id);
  assert.equal((await post({ action: 'createSupplier', name: 'Other', email: 'not-an-email' })).status, 422);
  assert.equal((await post({ action: 'createSupplier' })).status, 422);
  assert.equal(await prisma.supplier.count({ where: { name: { contains: 'acme', mode: 'insensitive' } } }), 1);

  const product = await post({ action: 'createProduct', sku: 'NEW/1', name: 'HAFT - Green', sellPrice: 1_500_000 });
  assert.equal(product.status, 200, JSON.stringify(product.body));
  assert.equal(product.body.product.onWebsite, false);
  const row = await prisma.product.findUniqueOrThrow({ where: { sku: 'NEW/1' } });
  assert.deepEqual([row.webId, Number(row.costPrice), Number(row.sellPrice), row.productType], [null, 0, 1_500_000, 'SALEABLE']);
  assert.match(row.barcode ?? '', /^\d{13}$/);
  assert.equal((await post({ action: 'createProduct', sku: 'new/1', name: 'x', sellPrice: 1 })).status, 422);
  assert.equal((await post({ action: 'createProduct', sku: 'NEW/2', name: 'x' })).status, 422);
  assert.equal((await post({ action: 'createProduct', sku: 'NEW/2', name: 'x', sellPrice: 1, costPrice: -5 })).status, 422);
  assert.equal((await post({ action: 'createProduct', sku: 'NEW/2', name: 'x', sellPrice: 1, productType: 'TOY' })).status, 422);
  assert.ok(await prisma.activityLog.findFirst({ where: { action: 'API_CREATE_PRODUCT' } }));
  assert.ok(await prisma.activityLog.findFirst({ where: { action: 'API_CREATE_SUPPLIER' } }));
});

test('a personal key does what its role may, sees what its role sees, and what it makes carries its name', async () => {
  const pegah = await keyFor('پگاه', 'ADMIN');
  const sara = await keyFor('سارا', 'SALES');
  const anbar = await keyFor('انباردار', 'WAREHOUSE');
  const hesab = await keyFor('حسابدار', 'ACCOUNTANT');
  const line = [{ sku: 'PANJ/BLUE', quantity: 4, unitCost: 25, currency: 'CNY' }];

  const placed = await createPo({ items: line, status: 'PENDING_PAYMENT', additionalCosts: [{ title: 'حمل', amount: 10, currency: 'CNY' }] }, pegah.key);
  assert.equal(placed.status, 200, JSON.stringify(placed.body));
  assert.deepEqual(placed.body.purchaseOrder.tags, ['Claude · پگاه']);
  const log = await prisma.activityLog.findFirstOrThrow({ where: { action: 'API_CREATE_PURCHASE_ORDER' } });
  assert.equal(log.userId, pegah.user.id);
  assert.ok((await get('action=whoami', pegah.key)).body.actions.includes('createPurchaseOrder'));

  // Prices only with cost.edit: no other role may place a purchase order, as on the order form.
  for (const who of [sara, anbar, hesab]) assert.equal((await createPo({ items: line }, who.key)).status, 403);
  assert.equal((await post({ action: 'createSupplier', name: 'X' }, sara.key)).status, 403);
  assert.equal((await post({ action: 'createProduct', sku: 'S/1', name: 'x', sellPrice: 1 }, sara.key)).status, 403);
  assert.equal((await post({ action: 'createSupplier', name: 'Y' }, hesab.key)).status, 200);

  // The storekeeper makes a product, but sets no prices (no cost.edit, no sales.view): both start at 0.
  const product = await post({ action: 'createProduct', sku: 'W/1', name: 'انباری', sellPrice: 9, costPrice: 5 }, anbar.key);
  assert.equal(product.status, 200, JSON.stringify(product.body));
  assert.deepEqual([product.body.product.costPrice, product.body.product.sellPrice, product.body.ignored], [0, 0, ['costPrice', 'sellPrice']]);

  // Reading: quantities for stock.view, prices for cost.view, totals and payments for finance.view.
  const seenBy = async (key: string) => (await get('action=purchaseOrders', key)).body.purchaseOrders[0];
  const bySales = await seenBy(sara.key);
  assert.equal(bySales.items[0].quantity, 4);
  assert.equal(bySales.items[0].unitCost, undefined);
  assert.equal(bySales.additionalCosts, undefined);
  assert.deepEqual([bySales.totalAmount, bySales.payments, bySales.unpaidInToman], [undefined, undefined, undefined]);
  const byAccountant = await seenBy(hesab.key);
  assert.equal(byAccountant.items[0].unitCost, undefined);
  assert.equal(byAccountant.totalAmount, 110);
  assert.equal(byAccountant.additionalCosts[0].amount, 10);
  const byAdmin = await seenBy(pegah.key);
  assert.equal(byAdmin.items[0].unitCost, 25);
});

test('the list and the figures show a yuan order in yuan, never as Toman, and count it at today\'s rate', () => {
  const yuan = { status: 'PENDING_PAYMENT', createdAt: new Date(), totalAmount: 713.5, items: [{ currency: 'CNY' }], paidAmountInToman: 1_000_000, unpaidInToman: 6_135_000 };
  assert.deepEqual(foreignTotalOf(yuan), { amount: 713.5, currency: 'CNY' });
  assert.equal(tomanValueOf(yuan), 7_135_000);
  const toman = { ...yuan, totalAmount: 650_000, totalAmountInToman: 650_000, items: [{ currency: 'TOMAN' }] };
  assert.equal(foreignTotalOf(toman), undefined);
  assert.equal(tomanValueOf(toman), 650_000);
  // Without finance.view neither total reaches the page.
  assert.equal(foreignTotalOf({ ...yuan, totalAmount: undefined }), undefined);
  assert.equal(purchaseFigures([yuan, toman]).openValue, 7_785_000);
});
