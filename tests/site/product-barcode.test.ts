import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import {
  barcodeFormatFor,
  ean13CheckDigit,
  isStandardBarcode,
  isValidEan13,
  isValidUpcA,
  randomInStoreEan13,
  upcACheckDigit,
} from '@/lib/barcode-format';
import { generateUniqueBarcode } from '@/lib/barcode-utils';
import {
  countNonStandardBarcodes,
  createProduct,
  generateProductBarcodeAction,
  getProductsForLabels,
  importProducts,
  replaceNonStandardBarcodes,
} from '@/actions/product';
import { SITE_UNKNOWN_NAME, SITE_UNKNOWN_SKU } from '@/lib/site-sale-data';
import { buildScanIndex, resolveScan } from '@/lib/audit-scan';

// What the old generator stored for model 310: the SKU digits as a UPC-A, plus a random suffix after a collision.
const LEGACY = '000000003101-4821';
const EAN13 = '4006381333931';
const UPCA = '036000291452';

beforeEach(async () => {
  beforeQuery.fn = null;
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/** mulberry32: a seeded random, so every run draws the same codes. */
function seededRandom(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function product(sku: string, barcode: string | null, name = sku) {
  return prisma.product.create({ data: { name, sku, barcode, costPrice: 1, sellPrice: 1 } });
}

function placeholder() {
  return prisma.product.create({ data: { name: SITE_UNKNOWN_NAME, sku: SITE_UNKNOWN_SKU, costPrice: 0, sellPrice: 0 } });
}

async function barcodeOf(id: string) {
  return (await prisma.product.findUniqueOrThrow({ where: { id } })).barcode;
}

function newProductForm(name: string, sku: string) {
  return form({ name, sku, productType: 'SALEABLE', costPrice: '1', sellPrice: '1' });
}

test('EAN-13 and UPC-A check digits and validation', () => {
  assert.equal(ean13CheckDigit('400638133393'), 1);
  assert.equal(ean13CheckDigit('290000000000'), 1);
  assert.equal(upcACheckDigit('03600029145'), 2);
  assert.throws(() => ean13CheckDigit('40063813339'));
  assert.throws(() => upcACheckDigit('0360002914a'));

  assert.equal(isValidEan13(EAN13), true);
  assert.equal(isValidEan13(`0${UPCA}`), true); // a UPC-A is an EAN-13 with a leading 0
  for (const bad of ['4006381333932', '400638133393', '40063813339310', '400638133393a', ` ${EAN13}`, '']) {
    assert.equal(isValidEan13(bad), false, bad);
  }
  assert.equal(isValidUpcA(UPCA), true);
  for (const bad of ['036000291453', '03600029145', `0${UPCA}`, '03600029145x', '']) {
    assert.equal(isValidUpcA(bad), false, bad);
  }

  assert.equal(isStandardBarcode(EAN13), true);
  // A valid UPC-A printed correctly before, so its labels stay in use.
  assert.equal(isStandardBarcode(UPCA), true);
  for (const bad of [null, undefined, '', LEGACY, '4006381333932', '036000291453', 'PANJ/BLUE']) {
    assert.equal(isStandardBarcode(bad), false, String(bad));
  }
});

test('barcodeFormatFor picks the symbology that prints the stored code unchanged', () => {
  assert.equal(barcodeFormatFor(LEGACY), 'CODE128');
  assert.equal(barcodeFormatFor(UPCA), 'UPC');
  assert.equal(barcodeFormatFor(EAN13), 'EAN13');
  assert.equal(barcodeFormatFor('4006381333932'), 'CODE128'); // 13 digits, wrong check digit
  assert.equal(barcodeFormatFor('PANJ/BLUE'), 'CODE128');
});

test('randomInStoreEan13 is always a valid EAN-13 starting with 29', () => {
  const random = seededRandom(310);
  const codes = new Set<string>();
  for (let i = 0; i < 5000; i++) {
    const code = randomInStoreEan13(random);
    assert.match(code, /^29\d{11}$/);
    assert.equal(isValidEan13(code), true, code);
    codes.add(code);
  }
  assert.equal(codes.size, 5000);
  assert.equal(randomInStoreEan13(() => 0), '2900000000001');
});

test('generateUniqueBarcode skips a code another product has, and gives up after 20 tries', async () => {
  const taken = randomInStoreEan13(seededRandom(1));
  await product('310/BLACK', taken);

  // The first ten draws replay the ones that made `taken`; later draws come from another seed.
  const replay = seededRandom(1);
  const fresh = seededRandom(2);
  let draws = 0;
  const code = await generateUniqueBarcode(prisma, () => (draws++ < 10 ? replay() : fresh()));
  assert.equal(draws, 20, 'the taken code must be drawn first');
  assert.notEqual(code, taken);
  assert.equal(isValidEan13(code), true);

  await product('310/HAVANA', randomInStoreEan13(() => 0));
  let tries = 0;
  await assert.rejects(
    generateUniqueBarcode(prisma, () => {
      tries++;
      return 0;
    }),
  );
  assert.equal(tries, 20 * 10);
});

test('createProduct and importProducts give distinct in-store EAN-13 codes to products with the same SKU digits', async () => {
  for (const sku of ['310/BLACK', '310/HAVANA']) {
    const result = await createProduct({} as any, newProductForm(`310 - ${sku}`, sku));
    assert.equal(result.success, true, String(result.message));
  }
  const imported = await importProducts([{ name: '310 - Green', sku: '310/GREEN', costPrice: 1, sellPrice: 1 }]);
  assert.equal(imported.successCount, 1);

  const codes: string[] = (await prisma.product.findMany({ select: { barcode: true } })).map(
    (p: { barcode: string | null }) => String(p.barcode),
  );
  assert.equal(codes.length, 3);
  for (const code of codes) {
    assert.match(code, /^29\d{11}$/);
    assert.equal(isValidEan13(code), true, code);
  }
  assert.equal(new Set(codes).size, 3);
});

test('generateProductBarcodeAction refuses to replace a barcode unless asked, and replaces it when asked', async () => {
  const legacy = await product('310/BLACK', LEGACY);

  const refused = await generateProductBarcodeAction(legacy.id);
  assert.equal(refused.success, false);
  assert.equal(refused.message, 'این محصول قبلاً بارکد دارد.');
  assert.equal(await barcodeOf(legacy.id), LEGACY);

  const replaced = await generateProductBarcodeAction(legacy.id, true);
  assert.equal(replaced.success, true, replaced.message);
  assert.equal(replaced.message, 'بارکد جدید ساخته شد؛ برچسب‌های قبلی این کالا دیگر خوانده نمی‌شوند.');
  assert.equal(replaced.barcode, await barcodeOf(legacy.id));
  assert.equal(isValidEan13(String(replaced.barcode)), true);

  const blank = await product('320/GREEN', null);
  const first = await generateProductBarcodeAction(blank.id);
  assert.equal(first.success, true, first.message);
  assert.equal(first.message, 'بارکد با موفقیت تولید شد.');
  assert.equal(first.barcode, await barcodeOf(blank.id));
  assert.equal(isValidEan13(String(first.barcode)), true);
});

test('generateProductBarcodeAction needs stock.manage, and never overwrites a barcode issued meanwhile', async () => {
  const legacy = await product('310/BLACK', LEGACY);

  setTestRole(null);
  const anonymous = await generateProductBarcodeAction(legacy.id, true);
  assert.equal(anonymous.success, false);
  assert.equal(await barcodeOf(legacy.id), LEGACY);

  setTestRole('USER');
  assert.equal((await generateProductBarcodeAction(legacy.id, true)).success, false, 'issuing a barcode needs stock.manage');
  assert.equal(await barcodeOf(legacy.id), LEGACY);

  setTestRole('WAREHOUSE');
  beforeQuery.fn = async (params) => {
    if (params.model === 'Product' && params.action === 'updateMany') {
      beforeQuery.fn = null;
      // Another tab issued a new barcode a moment ago, and its label is already printed.
      await prisma.product.update({ where: { id: legacy.id }, data: { barcode: EAN13 } });
    }
  };
  const late = await generateProductBarcodeAction(legacy.id, true);
  assert.equal(beforeQuery.fn, null, 'the concurrent write must happen between the read and the write');
  assert.equal(late.success, false);
  assert.match(late.message, /هم‌زمان تغییر کرد/);
  assert.equal(await barcodeOf(legacy.id), EAN13);

  // Any signed-in user may issue one, as before.
  const byUser = await generateProductBarcodeAction(legacy.id, true);
  assert.equal(byUser.success, true, byUser.message);
});

test('replaceNonStandardBarcodes replaces hyphenated, wrong-check and missing codes, and nothing else', async () => {
  const hyphen = await product('310/BLACK', LEGACY);
  const wrongCheck = await product('310/HAVANA', '4006381333932');
  const missing = await product('320/GREEN', null);
  const ean = await product('YEK/BLACK', EAN13);
  const upc = await product('PANJ/BLUE', UPCA);
  const site = await placeholder();

  assert.equal(await countNonStandardBarcodes(), 3);

  setTestRole('USER');
  assert.equal(await countNonStandardBarcodes(), 3);
  const refused = await replaceNonStandardBarcodes();
  assert.equal(refused.success, false);
  assert.match(refused.message, /دسترسی غیرمجاز/);
  assert.equal(await barcodeOf(hyphen.id), LEGACY);

  setTestRole(null);
  await assert.rejects(countNonStandardBarcodes());
  assert.equal((await replaceNonStandardBarcodes()).success, false);

  setTestRole('ADMIN');
  const result = await replaceNonStandardBarcodes();
  assert.equal(result.success, true, result.message);
  assert.equal(result.replaced, 3);
  assert.equal(result.message, 'بارکد استاندارد برای ۳ کالا ساخته شد.');
  assert.deepEqual([...(result.replacedIds ?? [])].sort(), [hyphen.id, wrongCheck.id, missing.id].sort());

  const stored = new Map<string, string | null>(
    (await prisma.product.findMany()).map((p: { id: string; barcode: string | null }) => [p.id, p.barcode]),
  );
  assert.equal(stored.get(ean.id), EAN13);
  // A valid 12-digit code printed correctly before: its labels keep scanning.
  assert.equal(stored.get(upc.id), UPCA);
  assert.equal(stored.get(site.id), null);
  for (const id of [hyphen.id, wrongCheck.id, missing.id]) assert.match(String(stored.get(id)), /^29\d{11}$/);
  stored.delete(site.id);
  const codes = [...stored.values()];
  assert.equal(codes.every((code) => isStandardBarcode(code)), true);
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(await countNonStandardBarcodes(), 0);
});

test('replaceNonStandardBarcodes works through batches and skips a product whose barcode changed meanwhile', async () => {
  await prisma.product.createMany({
    data: Array.from({ length: 250 }, (_, i) => ({
      name: `310 - Colour ${i}`,
      sku: `310/C${i}`,
      barcode: `000000003101-${String(i).padStart(4, '0')}`,
      costPrice: 1,
      sellPrice: 1,
    })),
  });
  const changed = await prisma.product.findUniqueOrThrow({ where: { sku: '310/C7' } });
  beforeQuery.fn = async (params) => {
    if (params.model === 'Product' && params.action === 'findUnique') {
      beforeQuery.fn = null;
      // Someone gives this product a code from its page while the replacement runs.
      await prisma.product.update({ where: { id: changed.id }, data: { barcode: 'TYPED-BY-HAND' } });
    }
  };

  const result = await replaceNonStandardBarcodes();
  assert.equal(beforeQuery.fn, null, 'the concurrent write must happen after the products were read');
  assert.equal(result.success, true, result.message);
  assert.equal(result.replaced, 249);
  assert.equal(await barcodeOf(changed.id), 'TYPED-BY-HAND');

  const codes: string[] = (await prisma.product.findMany({ where: { id: { not: changed.id } } })).map(
    (p: { barcode: string | null }) => String(p.barcode),
  );
  assert.equal(codes.length, 249);
  assert.equal(codes.every((code) => isValidEan13(code)), true);
  assert.equal(new Set(codes).size, 249);
  assert.equal(await countNonStandardBarcodes(), 1);
});

test('getProductsForLabels filters by search, stock and barcode, with the quantity in the chosen warehouse', async () => {
  const shop = await prisma.warehouse.create({ data: { name: 'Shop' } });
  const store = await prisma.warehouse.create({ data: { name: 'Store' } });
  const black = await prisma.product.create({
    data: { name: '310 - Black', sku: '310/BLACK', webId: 'MOAK-310-BLACK', barcode: EAN13, costPrice: 1, sellPrice: 1 },
  });
  const havana = await product('310/HAVANA', LEGACY, '310 - Havana');
  const green = await product('320/GREEN', null, '320 - Green');
  await placeholder();
  await prisma.inventory.createMany({
    data: [
      { productId: black.id, warehouseId: shop.id, quantity: 4 },
      { productId: havana.id, warehouseId: shop.id, quantity: 0 },
      { productId: havana.id, warehouseId: store.id, quantity: 9 },
      { productId: green.id, warehouseId: store.id, quantity: 2 },
    ],
  });

  assert.deepEqual(await getProductsForLabels({}), [
    { id: black.id, name: '310 - Black', sku: '310/BLACK', webId: 'MOAK-310-BLACK', barcode: EAN13, format: 'EAN13', quantity: null },
    { id: havana.id, name: '310 - Havana', sku: '310/HAVANA', webId: null, barcode: LEGACY, format: 'CODE128', quantity: null },
    { id: green.id, name: '320 - Green', sku: '320/GREEN', webId: null, barcode: null, format: null, quantity: null },
  ]);

  const skus = async (input: Parameters<typeof getProductsForLabels>[0]) =>
    (await getProductsForLabels(input)).map((p) => p.sku);
  assert.deepEqual(await skus({ search: '310' }), ['310/BLACK', '310/HAVANA']);
  assert.deepEqual(await skus({ search: 'moak-310-black' }), ['310/BLACK']); // webId, any case
  assert.deepEqual(await skus({ search: '4821' }), ['310/HAVANA']); // barcode
  assert.deepEqual(await skus({ search: ' green ' }), ['320/GREEN']); // name and SKU, any case
  assert.deepEqual(await skus({ search: 'unknown' }), []); // the SITE-UNKNOWN placeholder never gets a label

  const inShop = await getProductsForLabels({ warehouseId: shop.id });
  assert.deepEqual(inShop.map((p) => [p.sku, p.quantity]), [['310/BLACK', 4], ['310/HAVANA', 0], ['320/GREEN', 0]]);
  assert.deepEqual(await skus({ warehouseId: shop.id, inStockOnly: true }), ['310/BLACK']);
  assert.deepEqual(await skus({ warehouseId: store.id, inStockOnly: true }), ['310/HAVANA', '320/GREEN']);
  assert.deepEqual(await skus({ inStockOnly: true }), ['310/BLACK', '310/HAVANA', '320/GREEN']); // needs a warehouse
  assert.deepEqual(await skus({ nonStandardOnly: true }), ['310/HAVANA', '320/GREEN']);
  assert.deepEqual(
    await skus({ warehouseId: store.id, inStockOnly: true, nonStandardOnly: true, search: 'HAVANA' }),
    ['310/HAVANA'],
  );

  setTestRole(null);
  await assert.rejects(getProductsForLabels({}));
});

test('getProductsForLabels returns at most 2000 rows, counted after the non-standard filter', async () => {
  await prisma.product.createMany({
    data: Array.from({ length: 2001 }, (_, i) => ({
      name: `P${String(i).padStart(4, '0')}`,
      sku: `S${i}`,
      barcode: i === 0 ? EAN13 : null,
      costPrice: 1,
      sellPrice: 1,
    })),
  });
  const all = await getProductsForLabels({});
  assert.equal(all.length, 2000);
  assert.equal(all[0].name, 'P0000');

  const nonStandard = await getProductsForLabels({ nonStandardOnly: true });
  assert.equal(nonStandard.length, 2000);
  assert.equal(nonStandard[0].name, 'P0001');
  assert.equal(nonStandard[1999].name, 'P2000');
});

test('the count scanner finds a legacy code scanned exactly, and a new EAN-13; a replaced code no longer scans', async () => {
  const legacy = await product('310/BLACK', LEGACY);
  const created = await createProduct({} as any, newProductForm('310 - Havana', '310/HAVANA'));
  assert.equal(created.success, true, String(created.message));
  const fresh = await prisma.product.findUniqueOrThrow({ where: { sku: '310/HAVANA' } });

  const scanIndex = async () =>
    buildScanIndex(
      (await prisma.product.findMany()).map((p: { id: string; barcode: string | null; sku: string; webId: string | null }) => ({
        productId: p.id,
        barcode: p.barcode,
        sku: p.sku,
        webId: p.webId,
      })),
    );
  let index = await scanIndex();
  assert.deepEqual(resolveScan(index, `${LEGACY}\r\n`), { kind: 'match', productId: legacy.id, code: LEGACY });
  assert.deepEqual(resolveScan(index, String(fresh.barcode)), { kind: 'match', productId: fresh.id, code: fresh.barcode });

  const replaced = await generateProductBarcodeAction(legacy.id, true);
  assert.equal(replaced.success, true, replaced.message);
  index = await scanIndex();
  assert.deepEqual(resolveScan(index, String(replaced.barcode)), { kind: 'match', productId: legacy.id, code: replaced.barcode });
  assert.equal(resolveScan(index, LEGACY).kind, 'unknown');
});

test('replacing non-standard codes keeps a valid 12-digit code, and its printed label, scanning as before', async () => {
  // The old generator's UPC-A for SKU digits 3101; the old print page printed such a code unchanged.
  const oldUpcA = `00000003101${upcACheckDigit('00000003101')}`;

  const model310 = await product('310/BLACK', LEGACY);
  const other = await product('3101/GREEN', oldUpcA);
  const scanIndex = async () =>
    buildScanIndex(
      (await prisma.product.findMany()).map((p: { id: string; barcode: string | null; sku: string; webId: string | null }) => ({
        productId: p.id,
        barcode: p.barcode,
        sku: p.sku,
        webId: p.webId,
      })),
    );

  assert.equal(await countNonStandardBarcodes(), 1);
  assert.deepEqual((await getProductsForLabels({ nonStandardOnly: true })).map((p) => p.sku), ['310/BLACK']);
  const result = await replaceNonStandardBarcodes();
  assert.equal(result.replaced, 1, result.message);
  assert.deepEqual(result.replacedIds, [model310.id]);

  const index = await scanIndex();
  assert.equal(await barcodeOf(other.id), oldUpcA);
  assert.deepEqual(resolveScan(index, oldUpcA), { kind: 'match', productId: other.id, code: oldUpcA });
  // A scanner may send a UPC-A as an EAN-13 with a leading 0.
  assert.equal(resolveScan(index, `0${oldUpcA}`).kind, 'match');
  assert.equal(resolveScan(index, LEGACY).kind, 'unknown');
  const code = String(await barcodeOf(model310.id));
  assert.deepEqual(resolveScan(index, code), { kind: 'match', productId: model310.id, code });
});
