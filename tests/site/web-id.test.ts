import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWebId } from '@/lib/web-id';

test('accepts the documented examples', () => {
  for (const id of ['MOAK-PANJ-BLUE', 'MOAK-320W-HAVANA', 'MOAK-DAMN-RAW-WHITE', 'MOAK-VECTOR-ONE-GREEN']) {
    assert.deepEqual(parseWebId(id), { ok: true, value: id });
  }
});

test('trims spaces, and empty means "not sold on the site"', () => {
  assert.deepEqual(parseWebId('  MOAK-YEK-BLACK '), { ok: true, value: 'MOAK-YEK-BLACK' });
  assert.deepEqual(parseWebId(''), { ok: true, value: null });
  assert.deepEqual(parseWebId('   '), { ok: true, value: null });
  assert.deepEqual(parseWebId(null), { ok: true, value: null });
});

test('rejects anything outside the MOAK- format', () => {
  for (const bad of [
    'moak-panj-blue',
    'PANJ-BLUE',
    'MOAK',
    'MOAK-',
    'MOAK-PANJ-',
    'MOAK--PANJ',
    'MOAK-PANJ BLUE',
    'MOAK-PANJ/BLUE',
    'MOAK-پنج',
    'MOAK-PANJ-blue',
  ]) {
    const result = parseWebId(bad);
    assert.equal(result.ok, false, `should reject ${JSON.stringify(bad)}`);
  }
});
