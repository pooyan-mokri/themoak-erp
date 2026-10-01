import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { closePurchaseOrderShort } from '@/actions/supplier';
import { closePo4Short } from '../../scripts/datafix-2026-10-01-close-po4-short';
import { tableHashes, changedTables } from './sql';

// scripts/datafix-2026-10-01-close-po4-short.ts closes purchase order #4 short exactly as «بستن با کسری» on the
// order page does (closePurchaseOrderShort): the same lib function, the same rows.

console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const RATE = 26_000;

/** #4 as the real data has it, in small: CNY lines, an order cost, an arrival cost, VOID/GREN 2 short, paid in full. */
async function fixture(paidInFull = true) {
  await prisma.exchangeRate.create({ data: { currency: 'CNY', rateToToman: RATE, date: new Date('2026-06-01T00:00:00Z') } });
  await prisma.account.create({ data: { id: 'bank', name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  const supplier = await prisma.supplier.create({ data: { name: 'FINEWELL' } });
  const shop = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const lines: Array<[string, number, number, number, number]> = [
    // sku, ordered, received, unit CNY, on hand now
    ['VOID/GREN', 10, 8, 67, 0],
    ['NICHE/BLK', 6, 6, 67, 6],
    ['TONAL/BLK', 10, 10, 61, 7],
  ];
  const goods = lines.reduce((sum, [, ordered, , cny]) => sum + ordered * cny * RATE, 0);
  const logo = 247 * RATE;
  const order = await prisma.purchaseOrder.create({
    data: { number: 4, supplierId: supplier.id, status: 'PARTIALLY_RECEIVED', totalAmount: goods / RATE + 247, totalAmountInToman: goods + logo },
  });
  for (const [sku, ordered, received, cny, onHand] of lines) {
    const product = await prisma.product.create({ data: { name: sku, sku, costPrice: cny * RATE + 1_300_000, sellPrice: 9_000_000 } });
    if (onHand) await prisma.inventory.create({ data: { productId: product.id, warehouseId: shop.id, quantity: onHand } });
    await prisma.purchaseOrderItem.create({
      data: {
        purchaseOrderId: order.id, productId: product.id, quantity: ordered, receivedQuantity: received, unitCost: cny, currency: 'CNY',
        exchangeRateSnapshot: RATE, unitCostInToman: cny * RATE, totalCostInToman: received * (cny * RATE + 600_000),
      },
    });
  }
  await prisma.purchaseOrderAdditionalCost.create({ data: { purchaseOrderId: order.id, title: 'LOGO', amount: 247, currency: 'CNY', exchangeRateSnapshot: RATE, amountInToman: logo } });
  await prisma.purchaseOrderArrivalCost.create({ data: { purchaseOrderId: order.id, title: 'حمل و نقل و ترخیص', amount: 22_620_000, amountInToman: 22_620_000 } });
  await prisma.purchaseOrderPayment.create({ data: { purchaseOrderId: order.id, amount: 20_000_000, accountId: 'bank' } });
  if (paidInFull) {
    await prisma.purchaseOrderPayment.create({
      data: { purchaseOrderId: order.id, amount: goods + logo - 20_000_000, description: 'پرداخت‌شده بیرون از سیستم — ثبت اصلاحی' },
    });
  }
  return order.id;
}

/** What closing changes, keyed by sku and number rather than ids. */
async function result() {
  const po = await prisma.purchaseOrder.findFirstOrThrow({
    where: { number: 4 },
    include: { items: { include: { product: true } }, supplierCredits: { include: { supplier: true } } },
  });
  return {
    status: po.status,
    lines: po.items.map((i: any) => [i.product.sku, Number(i.totalCostInToman)]).sort(),
    costPrices: (await prisma.product.findMany()).map((p: any) => [p.sku, Number(p.costPrice)]).sort(),
    credits: po.supplierCredits.map((c: any) => [c.supplier.name, Number(c.amount), c.reason, c.clientRequestId === `po-short:${po.id}`]),
    stock: (await prisma.inventory.findMany({ include: { product: true } })).map((i: any) => [i.product.sku, i.quantity]).sort(),
    payments: (await prisma.purchaseOrderPayment.findMany()).map((p: any) => Number(p.amount)).sort(),
  };
}

test('the script closes #4 short with exactly the rows the order page\'s close writes', async () => {
  const viaPage = await (async () => {
    const id = await fixture();
    const done = await closePurchaseOrderShort(id);
    assert.equal(done.success, true, done.error);
    return result();
  })();
  await resetDatabase();
  await fixture();
  const message = await closePo4Short(prisma);
  const viaScript = await result();

  assert.deepEqual(viaScript, viaPage);
  // FINEWELL is owed the 2 missing VOID/GREN at their Toman price.
  assert.deepEqual(viaScript.credits, [['FINEWELL', 2 * 67 * RATE, 'کسری سفارش خرید #4', true]]);
  assert.equal(viaScript.status, 'RECEIVED');
  assert.match(message, /^#4 closed short: 2 units missing, .* FINEWELL credited 3484000 toman\.$/);

  // A second run changes nothing.
  const before = await tableHashes();
  assert.match(await closePo4Short(prisma), /already closed short/);
  assert.deepEqual(changedTables(before, await tableHashes()), []);
});

test('the script refuses, changing nothing, an order that is not as Pooyan described', async () => {
  await fixture(false);
  const before = await tableHashes();
  await assert.rejects(closePo4Short(prisma), /paid 20000000 of .*run datafix-2026-10-01-ALL\.sql first/);
  assert.deepEqual(changedTables(before, await tableHashes()), []);
});
