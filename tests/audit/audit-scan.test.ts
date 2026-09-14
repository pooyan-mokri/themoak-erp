import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScanIndex, hasPersianLetters, normalizeScanCode, resolveScan } from '@/lib/audit-scan';

const items = [
  { productId: 'panj', sku: 'PANJ/BLUE', webId: 'MOAK-PANJ-BLUE', barcode: '000000003209' },
  { productId: 'yek', sku: 'YEK/BLACK', webId: null, barcode: '6260000000017' },
  { productId: 'havana', sku: '320W/HAVANA', webId: 'MOAK-320W-HAVANA', barcode: null },
  { productId: 'clash', sku: 'X1', barcode: 'panj/blue' }, // panj's SKU once upper-cased
  { productId: 'same', sku: 'SAME-1', webId: null, barcode: 'same-1' }, // barcode and SKU: one key, one product
];

test('normalizeScanCode strips controls and invisible marks, converts Persian and Arabic digits, trims, upper-cases', () => {
  assert.equal(normalizeScanCode('moak-panj-blue\r\n'), 'MOAK-PANJ-BLUE');
  assert.equal(normalizeScanCode('\tPANJ/BLUE \n'), 'PANJ/BLUE');
  assert.equal(normalizeScanCode('  6260000000017  '), '6260000000017');
  assert.equal(normalizeScanCode('۶۲۶۰۰۰۰۰۰۰۰۱۷'), '6260000000017');
  assert.equal(normalizeScanCode('٦٢٦٠٠٠٠٠٠٠٠١٧'), '6260000000017');
  assert.equal(normalizeScanCode('\u200F\u202B62\u200B60\u200C000\u2067000\u2069017\uFEFF\u0000\u007F\u0085 '), '6260000000017');
});

test('hasPersianLetters: Arabic-script letters and harakat yes; digits and Latin text no', () => {
  assert.equal(hasPersianLetters('پخشن-حشدت-ذمعث'), true);
  assert.equal(hasPersianLetters('MOAK-ضانج'), true);
  assert.equal(hasPersianLetters('\u064B\u064C'), true); // Shift on a Persian layout types harakat
  assert.equal(hasPersianLetters('MOAK-PANJ-BLUE'), false);
  assert.equal(hasPersianLetters('۶۲۶۰۰۰۰۰۰۰۰۱۷'), false);
  assert.equal(hasPersianLetters('٦٢٦٠٠٠٠٠٠٠٠١٧'), false);
  assert.equal(hasPersianLetters(''), false);
});

test('resolveScan matches barcode, SKU and webId after normalising', () => {
  const index = buildScanIndex(items);
  const cases: Array<[string, string, string]> = [
    ['000000003209', 'panj', '000000003209'],
    ['MOAK-PANJ-BLUE', 'panj', 'MOAK-PANJ-BLUE'],
    ['moak-panj-blue\r\n', 'panj', 'MOAK-PANJ-BLUE'],
    [' yek/black ', 'yek', 'YEK/BLACK'],
    ['MOAK-320W-HAVANA', 'havana', 'MOAK-320W-HAVANA'],
    ['320w/havana\t', 'havana', '320W/HAVANA'],
    ['۶۲۶۰۰۰۰۰۰۰۰۱۷', 'yek', '6260000000017'],
    ['٦٢٦٠٠٠٠٠٠٠٠١٧', 'yek', '6260000000017'],
    ['\u200F6260000000017\u0000 ', 'yek', '6260000000017'],
    ['same-1', 'same', 'SAME-1'],
  ];
  for (const [raw, productId, code] of cases) {
    assert.deepEqual(resolveScan(index, raw), { kind: 'match', productId, code }, JSON.stringify(raw));
  }
});

test('a UPC-A code matches when read as EAN-13 with a leading 0, and the reverse', () => {
  const index = buildScanIndex([
    { productId: 'upc', sku: 'U', barcode: '000000003209' },
    { productId: 'ean', sku: 'E', barcode: '0123456789012' },
    { productId: 'plain', sku: 'P', barcode: '6260000000017' },
  ]);
  assert.deepEqual(resolveScan(index, '0000000003209'), { kind: 'match', productId: 'upc', code: '0000000003209' });
  assert.deepEqual(resolveScan(index, '123456789012'), { kind: 'match', productId: 'ean', code: '123456789012' });
  assert.equal(resolveScan(index, '0000000032090').kind, 'unknown'); // 13 digits, but not 0 + the 12-digit code
  assert.equal(resolveScan(index, '260000000017').kind, 'unknown'); // an EAN-13 not starting with 0 has no variant
  assert.equal(resolveScan(index, '06260000000017').kind, 'unknown');
});

test('a key shared by two products is ambiguous', () => {
  const index = buildScanIndex(items);
  assert.deepEqual(resolveScan(index, 'panj/blue'), {
    kind: 'ambiguous',
    productIds: ['panj', 'clash'],
    code: 'PANJ/BLUE',
  });
  // A UPC-A and its EAN-13 form are one printed symbol, so two products holding them cannot be told apart.
  const upcEan = buildScanIndex([
    { productId: 'a', sku: 'A', barcode: '123456789012' },
    { productId: 'b', sku: 'B', barcode: '0123456789012' },
  ]);
  for (const code of ['123456789012', '0123456789012']) {
    assert.deepEqual(resolveScan(upcEan, code), { kind: 'ambiguous', productIds: ['a', 'b'], code });
  }
});

test('empty and unknown codes; Persian-layout text is unknown with the layout hint', () => {
  const index = buildScanIndex(items);
  assert.deepEqual(resolveScan(index, ''), { kind: 'empty' });
  assert.deepEqual(resolveScan(index, ' \r\n\u200F'), { kind: 'empty' });
  assert.deepEqual(resolveScan(index, 'no-such-code'), { kind: 'unknown', code: 'NO-SUCH-CODE', persianLayout: false });
  assert.deepEqual(resolveScan(index, 'پخشن-حشدت-ذمعث\r'), {
    kind: 'unknown',
    code: 'پخشن-حشدت-ذمعث',
    persianLayout: true,
  });
});

test('blank barcode, SKU and webId values are not keys', () => {
  const index = buildScanIndex([
    { productId: 'x', sku: '  ', barcode: '', webId: null },
    { productId: 'y', sku: '\r\n', barcode: undefined },
  ]);
  assert.equal(index.size, 0);
});
