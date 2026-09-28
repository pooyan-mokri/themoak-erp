import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOW_STOCK_MAX, stockLevel } from '@/lib/stock-levels';

// Pooyan's rule, the same on every screen: out of stock is 0 or less, low is 1 to 3.

test('stock levels: 0 and negative rows are out of stock, 1 to 3 is low, 4 and up is fine', () => {
  assert.equal(LOW_STOCK_MAX, 3);
  assert.deepEqual([-5, -1, 0, 1, 2, 3, 4, 10, 1_000].map(stockLevel), ['OUT', 'OUT', 'OUT', 'LOW', 'LOW', 'LOW', 'OK', 'OK', 'OK']);
});

test('a sale line nets its returns and exchanges, and carries the order discount in proportion to what it still sold', async () => {
  const { netLineSale } = await import('@/lib/product-sales');
  const panj = { quantity: 3, price: 2_000_000, returns: [{ quantity: 1 }], exchanges: [{ quantity: 1 }] };
  const yek = { quantity: 1, price: 1_000_000 };
  assert.deepEqual(netLineSale(panj, { discount: 600_000, items: [panj, yek] }), { units: 1, revenue: 2_000_000 - 400_000 });
  // Everything returned: nothing sold, nothing earned.
  const back = { quantity: 2, price: 2_000_000, returns: [{ quantity: 2 }] };
  assert.deepEqual(netLineSale(back, { discount: 500_000, items: [back] }), { units: 0, revenue: 0 });
  // A discount larger than what is still sold never makes revenue negative.
  assert.deepEqual(netLineSale(yek, { discount: 5_000_000, items: [yek] }), { units: 1, revenue: 0 });
  assert.deepEqual(netLineSale(yek, { items: [yek] }), { units: 1, revenue: 1_000_000 });
});
