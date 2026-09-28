import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tomanTick } from '@/lib/chart-format';

// The money charts' axis ticks were full Toman amounts that did not fit the axis (cropped on the financial
// report, overlapping the plot on the dashboard) and, where no formatter was set, in Latin digits.

test('an axis tick is short and in Persian digits', () => {
  assert.equal(tomanTick(0), '۰');
  assert.equal(tomanTick(950_000), '۹۵۰٬۰۰۰');
  assert.equal(tomanTick(120_000_000), '۱۲۰ میلیون');
  assert.equal(tomanTick(1_500_000_000), '۱٫۵ میلیارد');
  assert.equal(tomanTick(-45_000_000), '‎−۴۵ میلیون');
});
