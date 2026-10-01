import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import moment from 'moment-jalaali';
import { prisma, resetDatabase } from '../helpers/db';
import { changedTables, rowsHash, runFix, runTwice, tableHashes } from './sql';

// prisma/sql/datafix-2026-10-01-jalali-dates.sql: orders the old WooCommerce sync stored in 1404–1405 AD (a
// Jalali date read as Gregorian) and every row tied to them get the Gregorian date, the time of day kept.

beforeEach(() => resetDatabase());
after(() => prisma.$disconnect());

/** The Gregorian day of a Jalali one, by moment-jalaali (the app's own Jalali calendar). */
const gregorian = (jy: number, jm: number, jd: number) => moment(`${jy}/${jm}/${jd}`, 'jYYYY/jM/jD').format('YYYY-MM-DD');
const stored = (jy: number, jm: number, jd: number, time: string) =>
  new Date(`${String(jy).padStart(4, '0')}-${String(jm).padStart(2, '0')}-${String(jd).padStart(2, '0')}T${time}Z`);

/** A stored day the sync could have rolled over from a Jalali day the Gregorian calendar lacks. */
const ambiguous = (jm: number, jd: number) => (jm === 3 && jd <= 3) || ((jm === 5 || jm === 7) && jd === 1);

test('every Jalali day of 1404 and of 1405 up to now converts as the app\'s calendar does, keeping the time', async () => {
  const days: Array<[number, number, number]> = [];
  for (const jy of [1404, 1405]) {
    for (let jm = 1; jm <= 12; jm++) {
      const length = jm <= 6 ? 31 : jm <= 11 ? 30 : moment.jIsLeapYear(jy) ? 30 : 29;
      // Only the days a Gregorian date can hold (no 30 February): the others never reached the database.
      const gregorianLength = new Date(Date.UTC(2000, jm, 0)).getUTCDate() - (jm === 2 && jy % 4 !== 0 ? 1 : 0);
      for (let jd = 1; jd <= Math.min(length, gregorianLength); jd++) {
        if (ambiguous(jm, jd)) continue;
        if (new Date(`${gregorian(jy, jm, jd)}T23:59:59Z`) < new Date()) days.push([jy, jm, jd]);
      }
    }
  }
  assert.ok(days.length > 500);
  const orders = [];
  for (const [i, [jy, jm, jd]] of days.entries()) {
    orders.push({ number: 100_000 + i, totalAmount: 1, createdAt: stored(jy, jm, jd, '18:22:36.000') });
  }
  await prisma.order.createMany({ data: orders });

  await runTwice('datafix-2026-10-01-jalali-dates.sql', ['Order']);

  const fixed = await prisma.order.findMany({ orderBy: { number: 'asc' } });
  for (const [i, [jy, jm, jd]] of days.entries()) {
    assert.equal(fixed[i].createdAt.toISOString(), `${gregorian(jy, jm, jd)}T18:22:36.000Z`, `${jy}/${jm}/${jd}`);
  }
});

test('the rows tied to such an order move with it; everything else stays', async () => {
  const account = await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  const shop = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const product = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 1, sellPrice: 1 } });
  const checkout = await prisma.transaction.create({ data: { type: 'INCOME', amount: 5, amountInToman: 5, accountId: account.id, date: stored(1404, 9, 28, '18:22:36.000') } });
  const order = await prisma.order.create({
    data: { totalAmount: 5, wooId: 79, transactionId: checkout.id, createdAt: stored(1404, 9, 28, '18:22:36.000'), items: { create: [{ productId: product.id, quantity: 1, price: 5, warehouseId: shop.id }] } },
    include: { items: true },
  });
  const cogs = await prisma.transaction.create({ data: { type: 'EXPENSE', category: 'COGS', amount: 1, amountInToman: 1, orderId: order.id, date: stored(1404, 9, 28, '18:22:36.000') } });
  const later = await prisma.transaction.create({ data: { type: 'INCOME', amount: 1, amountInToman: 1, accountId: account.id, orderId: order.id, date: new Date('2026-01-05T10:00:00Z') } });
  const movement = await prisma.inventoryMovement.create({ data: { productId: product.id, fromWarehouseId: shop.id, quantity: 1, type: 'SALE', referenceId: order.id, createdAt: stored(1404, 9, 28, '18:22:36.000') } });
  const back = await prisma.orderReturn.create({ data: { orderId: order.id, orderItemId: order.items[0].id, quantity: 1, refundAmount: 0, accountId: account.id, createdAt: stored(1404, 10, 2, '09:00:00.000') } });
  // Left alone: a normal order, and a row in 1404 AD tied to no such order.
  const normal = await prisma.order.create({ data: { totalAmount: 1, createdAt: new Date('2026-02-01T08:00:00Z') } });
  const stray = await prisma.transaction.create({ data: { type: 'INCOME', amount: 1, amountInToman: 1, accountId: account.id, date: stored(1404, 1, 1, '00:00:00.000') } });
  const untouched = await rowsHash('Transaction', [checkout.id, cogs.id]);

  await runTwice('datafix-2026-10-01-jalali-dates.sql', ['InventoryMovement', 'Order', 'OrderReturn', 'Transaction']);

  const iso = (d: Date) => d.toISOString();
  assert.equal(iso((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).createdAt), '2025-12-19T18:22:36.000Z');
  assert.equal(iso((await prisma.transaction.findUniqueOrThrow({ where: { id: checkout.id } })).date), '2025-12-19T18:22:36.000Z');
  assert.equal(iso((await prisma.transaction.findUniqueOrThrow({ where: { id: cogs.id } })).date), '2025-12-19T18:22:36.000Z');
  assert.equal(iso((await prisma.inventoryMovement.findUniqueOrThrow({ where: { id: movement.id } })).createdAt), '2025-12-19T18:22:36.000Z');
  assert.equal(iso((await prisma.orderReturn.findUniqueOrThrow({ where: { id: back.id } })).createdAt), '2025-12-23T09:00:00.000Z');
  assert.equal(iso((await prisma.transaction.findUniqueOrThrow({ where: { id: later.id } })).date), '2026-01-05T10:00:00.000Z');
  assert.equal(iso((await prisma.order.findUniqueOrThrow({ where: { id: normal.id } })).createdAt), '2026-02-01T08:00:00.000Z');
  assert.equal(iso((await prisma.transaction.findUniqueOrThrow({ where: { id: stray.id } })).date), stored(1404, 1, 1, '00:00:00.000').toISOString());
  assert.equal(await rowsHash('Transaction', [checkout.id, cogs.id]), untouched);
});

test('a stored day the sync may have rolled over stops the run and changes nothing', async () => {
  await prisma.order.create({ data: { number: 1, totalAmount: 1, createdAt: stored(1404, 2, 1, '10:00:00.000') } });
  await prisma.order.create({ data: { number: 2, totalAmount: 1, createdAt: stored(1404, 5, 1, '10:00:00.000') } });
  const before = await tableHashes();
  await assert.rejects(runFix('datafix-2026-10-01-jalali-dates.sql'), /1 dates may be a Jalali day rolled over/);
  assert.deepEqual(changedTables(before, await tableHashes()), []);
});

test('a date that would land outside 1 Farvardin 1404 .. now stops the run and changes nothing', async () => {
  await prisma.order.create({ data: { number: 1, totalAmount: 1, createdAt: stored(1404, 2, 1, '10:00:00.000') } });
  await prisma.order.create({ data: { number: 2, totalAmount: 1, createdAt: stored(1403, 12, 1, '10:00:00.000') } }); // 2025-02-19
  const before = await tableHashes();
  await assert.rejects(runFix('datafix-2026-10-01-jalali-dates.sql'), /1 dates would fall outside 2025-03-21 \.\. now; nothing changed/);
  assert.deepEqual(changedTables(before, await tableHashes()), []);
});
