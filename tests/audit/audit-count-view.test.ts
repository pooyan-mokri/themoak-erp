import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESOLVE_CONFLICTS_FIRST,
  confirmedKey,
  countOf,
  foldSearchText,
  forgetConfirmedCounts,
  knownCount,
  lastCount,
  matchesFilter,
  matchesSearch,
  parseRound,
  parseWholeNumber,
  roundChangeBlock,
  roundTotals,
  type AuditCountItem,
  type ItemFilter,
} from '@/components/inventory/audit-count-view';

function item(productId: string, fields: Partial<Omit<AuditCountItem, 'productId'>> = {}): AuditCountItem {
  return { productId, systemQuantity: 0, product: { name: productId, sku: productId.toUpperCase() }, ...fields };
}

test('parseRound reads ?round=2 and 3; anything else is round 1', () => {
  assert.equal(parseRound('2'), 2);
  assert.equal(parseRound('3'), 3);
  for (const value of ['1', null, undefined, '', '4', '0', ' 2', 'two']) assert.equal(parseRound(value), 1, String(value));
});

test('lastCount takes the latest round with a count, and 0 is a count', () => {
  assert.equal(lastCount(item('a')), null);
  assert.equal(lastCount(item('a', { countedQuantity1: 4 })), 4);
  assert.equal(lastCount(item('a', { countedQuantity1: 4, countedQuantity2: 0 })), 0);
  assert.equal(lastCount(item('a', { countedQuantity1: 4, countedQuantity2: null, countedQuantity3: 7 })), 7);
  assert.equal(lastCount(item('a', { countedQuantity1: 4, countedQuantity3: undefined })), 4);
  assert.equal(countOf(item('a', { countedQuantity2: 5 }), 1), null);
  assert.equal(countOf(item('a', { countedQuantity2: 5 }), 2), 5);
});

test('filters: uncounted with system stock, counted not final, last count differs from system, final', () => {
  const items = [
    item('uncounted', { systemQuantity: 3 }),
    item('uncountedNoStock', { systemQuantity: 0 }),
    item('negativeStock', { systemQuantity: -2 }),
    item('countedEqual', { systemQuantity: 3, countedQuantity1: 3 }),
    item('countedLess', { systemQuantity: 3, countedQuantity1: 2 }),
    item('recountEqual', { systemQuantity: 3, countedQuantity1: 2, countedQuantity2: 3 }),
    item('countedZeroNoStock', { systemQuantity: 0, countedQuantity1: 0 }),
    item('finalFromCount', { systemQuantity: 3, countedQuantity1: 0, finalQuantity: 0 }),
    item('finalZeroUncounted', { systemQuantity: 5, finalQuantity: 0 }),
  ];
  const ids = (filter: ItemFilter) => items.filter((i) => matchesFilter(i, filter)).map((i) => i.productId);
  assert.deepEqual(ids('all'), items.map((i) => i.productId));
  assert.deepEqual(ids('uncounted'), ['uncounted', 'negativeStock']);
  assert.deepEqual(ids('notFinal'), ['countedEqual', 'countedLess', 'recountEqual', 'countedZeroNoStock']);
  assert.deepEqual(ids('mismatch'), ['countedLess', 'finalFromCount']);
  assert.deepEqual(ids('final'), ['finalFromCount', 'finalZeroUncounted']);
});

test('search matches name, SKU, webId and barcode after folding digits, case, and Arabic yeh and kaf', () => {
  const arabicYeh = String.fromCharCode(0x064a);
  const arabicKaf = String.fromCharCode(0x0643);
  const persianYeh = String.fromCharCode(0x06cc);
  const persianKaf = String.fromCharCode(0x06a9);
  const frame = item('panj', {
    product: { name: `ع${arabicYeh}ن${arabicKaf} آفتابی`, sku: 'PANJ/BLUE', webId: 'MOAK-PANJ-BLUE', barcode: '000000003209' },
  });
  const plain = item('yek', { product: { name: 'Yek', sku: 'YEK/BLACK', webId: null, barcode: null } });
  const find = (query: string) => [frame, plain].filter((i) => matchesSearch(i, foldSearchText(query))).map((i) => i.productId);

  assert.deepEqual(find(`ع${persianYeh}ن${persianKaf}`), ['panj']);
  assert.deepEqual(find('moak-panj'), ['panj']);
  assert.deepEqual(find(' blue '), ['panj']);
  assert.deepEqual(find('۳۲۰۹'), ['panj']);
  assert.deepEqual(find('yek/'), ['yek']);
  assert.deepEqual(find(''), ['panj', 'yek']);
  assert.deepEqual(find('nothing'), []);
});

test('parseWholeNumber accepts whole numbers in Latin, Persian or Arabic digits only', () => {
  assert.equal(parseWholeNumber('12'), 12);
  assert.equal(parseWholeNumber('۱۲'), 12);
  assert.equal(parseWholeNumber('١٢'), 12);
  assert.equal(parseWholeNumber(' 7 '), 7);
  assert.equal(parseWholeNumber('0'), 0);
  for (const bad of ['', ' ', '1.5', '-1', '12a', '1e3', '+3', '1 2']) assert.equal(parseWholeNumber(bad), null, bad);
});

test('a count confirmed on this page wins over stale page data, per audit, round and product', () => {
  const a = item('a', { countedQuantity1: 2, countedQuantity2: 9 });
  const b = item('b');
  const c = item('c', { countedQuantity3: 4 });
  const confirmed = new Map<string, number | null>([
    [confirmedKey('audit-1', 1, 'a'), 5],
    [confirmedKey('audit-1', 1, 'b'), 0],
    [confirmedKey('audit-1', 3, 'c'), null],
    [confirmedKey('audit-2', 2, 'a'), 1],
  ]);
  assert.equal(knownCount(confirmed, 'audit-1', 1, a), 5);
  assert.equal(knownCount(confirmed, 'audit-1', 2, a), 9);
  assert.equal(knownCount(confirmed, 'audit-1', 1, b), 0);
  assert.equal(knownCount(confirmed, 'audit-1', 3, b), null);
  assert.equal(knownCount(confirmed, 'audit-1', 3, c), null);
  assert.deepEqual([...roundTotals('audit-1', 1, [a, b, c], confirmed)], [['a', 5], ['b', 0], ['c', null]]);
  assert.deepEqual([...roundTotals('audit-1', 2, [a, b, c], confirmed)], [['a', 9], ['b', null], ['c', null]]);
  assert.deepEqual([...roundTotals('audit-2', 3, [a, b, c], confirmed)], [['a', null], ['b', null], ['c', 4]]);
});

test('page data loaded again replaces the counts confirmed on this page, except unsaved ones of the open round', () => {
  const confirmed = new Map<string, number | null>([
    [confirmedKey('audit-1', 1, 'a'), 3],
    [confirmedKey('audit-1', 2, 'a'), 8],
    [confirmedKey('audit-1', 1, 'b'), 1],
    [confirmedKey('audit-1', 3, 'b'), null],
    [confirmedKey('audit-2', 1, 'a'), 7],
  ]);
  // Refreshed after another counter saved 5 for a in round 1 and cleared its round 2.
  const a = item('a', { countedQuantity1: 5 });
  const b = item('b', { countedQuantity1: 6, countedQuantity3: 2 });
  forgetConfirmedCounts(confirmed, 'audit-1', 1, [a, b], new Set(['b']));

  assert.deepEqual([...confirmed.keys()], [confirmedKey('audit-1', 1, 'b'), confirmedKey('audit-2', 1, 'a')]);
  assert.equal(knownCount(confirmed, 'audit-1', 1, a), 5, 'the refreshed 5, not the 3 confirmed before it');
  assert.equal(knownCount(confirmed, 'audit-1', 2, a), null);
  assert.equal(knownCount(confirmed, 'audit-1', 3, b), 2, 'kept only in the open round');
  assert.equal(knownCount(confirmed, 'audit-1', 1, b), 1, 'unsaved here: stays the base of what is sent');
});

test('the round changes only with every count saved and no conflict open; a conflict is named first', () => {
  assert.equal(roundChangeBlock(0, 0), null);
  assert.equal(roundChangeBlock(3, 0), 'اول صبر کنید همهٔ شمارش‌ها ذخیره شوند.');
  assert.equal(roundChangeBlock(1, 1), 'ابتدا شمارش‌های ناسازگار را حل کنید.');
  assert.equal(roundChangeBlock(4, 1), RESOLVE_CONFLICTS_FIRST);
});
