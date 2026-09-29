import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { createAsset, getAssets } from '@/actions/fixed-assets';
import { addToConsumable, consumableValue } from '@/lib/fixed-asset-value';

// Pooyan's decision: a consumable fixed asset is worth quantity × unit cost, and a later receipt adds to it.

console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

test('the rule: value is quantity × unit cost; adding units averages the unit cost and keeps the value of the units before', () => {
  assert.equal(consumableValue({ quantity: 100, purchasePrice: 50_000 }), 5_000_000);
  assert.equal(consumableValue({ quantity: null, purchasePrice: 50_000 }), 0);
  assert.deepEqual(addToConsumable({ quantity: 60, purchasePrice: 50_000 }, 40, 60_000), { quantity: 100, unitCost: 54_000, value: 5_400_000 });
  assert.deepEqual(addToConsumable({ quantity: 0, purchasePrice: 0 }, 10, 7_000), { quantity: 10, unitCost: 7_000, value: 70_000 });
});

test('a consumable entered by hand is worth its quantity × unit price, not depreciated; a fixed asset still depreciates', async () => {
  const fields = { name: 'دستمال', assetType: 'CONSUMABLE', purchaseDate: '2020-01-01', purchasePrice: '50000', salvageValue: '0', usefulLife: '1', quantity: '100' };
  assert.equal((await createAsset(undefined, form(fields))).success, true);
  const stored = await prisma.fixedAsset.findFirstOrThrow();
  assert.equal(Number(stored.currentValue), 5_000_000);
  await createAsset(undefined, form({ ...fields, name: 'دستگاه', assetType: 'FIXED', quantity: '', purchasePrice: '10000000', usefulLife: '5' }));
  const assets = await getAssets();
  const byName = Object.fromEntries(assets.map((a: any) => [a.name, a.currentValue]));
  assert.equal(byName['دستمال'], 5_000_000, 'bought years ago, still quantity × unit price');
  assert.equal(byName['دستگاه'], 0, 'a fixed asset past its useful life is at its salvage value');
});
