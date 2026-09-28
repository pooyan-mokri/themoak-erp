import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOW_STOCK_MAX, stockLevel } from '@/lib/stock-levels';

// Pooyan's rule, the same on every screen: out of stock is 0 or less, low is 1 to 3.

test('stock levels: 0 and negative rows are out of stock, 1 to 3 is low, 4 and up is fine', () => {
  assert.equal(LOW_STOCK_MAX, 3);
  assert.deepEqual([-5, -1, 0, 1, 2, 3, 4, 10, 1_000].map(stockLevel), ['OUT', 'OUT', 'OUT', 'LOW', 'LOW', 'LOW', 'OK', 'OK', 'OK']);
});
