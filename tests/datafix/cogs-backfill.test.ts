import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getProfitLossReport } from '@/actions/reports';
import { COGS_SOURCES, cogsSourceLabel } from '@/lib/cogs';
import { COGS_ACCOUNT_NAME } from '@/lib/expense-accounts';
import { balances, reportRows, rowsHash, runTwice } from './sql';

// prisma/sql/datafix-2026-10-01-cogs-backfill.sql: past sales that booked no cost of goods sold get it,
// at each product's cost price now, in the shape src/lib/cogs.ts books it. A sale that booked some is
// left: its COGS is at the price of its day.

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const FROM = new Date('2025-01-01T00:00:00Z');
const TO = new Date('2026-12-31T23:59:59Z');

async function world() {
  const customer = await prisma.customer.create({ data: { name: 'سارا' } });
  const partner = await prisma.customer.create({ data: { name: 'همکار' } });
  const shop = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const atPartner = await prisma.warehouse.create({ data: { name: 'امانی', isVirtual: true, customerId: partner.id } });
  const product = (sku: string, costPrice: number) =>
    prisma.product.create({ data: { name: sku, sku, costPrice, sellPrice: 2_000_000 } });
  const panj = await product('PANJ', 400_000);
  const yek = await product('YEK', 300_000);
  const free = await product('FREE', 0);
  /** An order whose lines are [product, quantity, warehouse]. */
  const order = async (lines: Array<[string, number, string | null]>, data: Record<string, unknown> = {}) =>
    prisma.order.create({
      data: {
        totalAmount: 1_000_000,
        createdAt: new Date('2026-05-10T09:00:00Z'),
        ...data,
        items: { create: lines.map(([productId, quantity, warehouseId]) => ({ productId, quantity, price: 1_000_000, warehouseId })) },
      },
      include: { items: true },
    });
  return { customer, partner, shop, atPartner, panj, yek, free, order };
}

test('each order missing COGS gets one row for what it misses, dated at the sale; nothing else changes', async () => {
  const w = await world();
  const cogsAccount = await prisma.account.create({ data: { name: COGS_ACCOUNT_NAME, type: 'EXPENSE', currency: 'TOMAN', balance: 0 } });
  const bank = await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 50_000_000 } });

  // A POS sale of 3, one returned and one exchanged away for a YEK: 1 PANJ and 1 YEK still sold.
  const pos = await w.order([[w.panj.id, 3, w.shop.id]], { customerId: w.customer.id });
  const swap = await prisma.orderItem.create({ data: { orderId: pos.id, productId: w.yek.id, quantity: 1, price: 1, warehouseId: w.shop.id } });
  await prisma.orderReturn.create({ data: { orderId: pos.id, orderItemId: pos.items[0].id, quantity: 1, refundAmount: 0, accountId: bank.id } });
  await prisma.orderExchange.create({
    data: { orderId: pos.id, originalItemId: pos.items[0].id, exchangeItemId: swap.id, quantity: 1, priceDifference: 0, accountId: bank.id },
  });
  // A consignment sale.
  const consignment = await w.order([[w.panj.id, 2, w.atPartner.id], [w.yek.id, 1, w.atPartner.id]], { customerId: w.partner.id });
  // Left: a consignment sale that booked its COGS the old way (no orderId, its number in the
  // description) at a lower price than today's, so the report lists it.
  const oldPrice = await w.order([[w.panj.id, 1, w.atPartner.id]], { customerId: w.partner.id });
  await prisma.transaction.create({
    data: { type: 'EXPENSE', amount: 350_000, amountInToman: 350_000, accountId: cogsAccount.id, category: 'COGS', description: `بهای تمام‌شده کالای فروش امانی - سفارش #${oldPrice.number}` },
  });
  // A website sale.
  const website = await w.order([[w.yek.id, 2, w.shop.id]], { siteReference: 'M-TEST1' });
  // Left: a sale whose COGS is booked, a cancelled sale, a free product, a guest sale fully returned.
  const booked = await w.order([[w.panj.id, 1, w.shop.id]]);
  await prisma.transaction.create({
    data: { type: 'EXPENSE', amount: 400_000, amountInToman: 400_000, accountId: cogsAccount.id, category: 'COGS', description: 'x', orderId: booked.id },
  });
  await w.order([[w.panj.id, 1, w.shop.id]], { status: 'CANCELLED' });
  await w.order([[w.free.id, 5, w.shop.id]]);
  const returned = await w.order([[w.yek.id, 1, w.shop.id]]);
  await prisma.orderReturn.create({ data: { orderId: returned.id, orderItemId: returned.items[0].id, quantity: 1, refundAmount: 0, accountId: bank.id } });

  const others = await rowsHash('Transaction');
  const accounts = await balances();
  assert.equal((await reportRows('report-sales-without-cogs.sql')).length, 4);
  const plBefore = (await getProfitLossReport(FROM, TO)).summary;

  await runTwice('datafix-2026-10-01-cogs-backfill.sql', ['Transaction']);

  const rows = await prisma.transaction.findMany({ where: { clientRequestId: { startsWith: 'cogs-backfill-' } }, orderBy: { amount: 'asc' } });
  const expected = [
    [website, 600_000, COGS_SOURCES.website, null],
    [pos, 700_000, COGS_SOURCES.pos, w.customer.id],
    [consignment, 800_000 + 300_000, COGS_SOURCES.consignment, w.partner.id],
  ] as const;
  assert.equal(rows.length, expected.length);
  for (const [i, [order, amount, source, customerId]] of expected.entries()) {
    const row: any = rows.find((r: any) => r.orderId === order.id);
    assert.deepEqual(
      {
        type: row.type, currency: row.currency, amount: Number(row.amount), amountInToman: Number(row.amountInToman),
        rateSnapshot: Number(row.rateSnapshot), accountId: row.accountId, category: row.category, description: row.description,
        customerId: row.customerId, date: row.date.toISOString(), clientRequestId: row.clientRequestId, tags: row.tags,
        transferGroupId: row.transferGroupId, exchangeGroupId: row.exchangeGroupId,
      },
      {
        type: 'EXPENSE', currency: 'TOMAN', amount, amountInToman: amount, rateSnapshot: 1, accountId: cogsAccount.id,
        category: 'COGS', description: `${source} - سفارش #${order.number}`, customerId, date: order.createdAt.toISOString(),
        clientRequestId: `cogs-backfill-${order.id}`, tags: [], transferGroupId: null, exchangeGroupId: null,
      },
      `row ${i}`,
    );
    assert.equal(cogsSourceLabel(row.description), source);
  }
  // Every other row, and every balance (the COGS account's 0 too), as it was.
  assert.equal(await rowsHash('Transaction', rows.map((r: any) => r.id)), others);
  assert.deepEqual(await balances(), accounts);
  // Only the sale booked at its day's price is still listed, and the P&L's cost of goods sold carries the rest.
  assert.deepEqual((await reportRows('report-sales-without-cogs.sql')).map((r: any) => [r.number, Number(r.missing_cogs)]), [[oldPrice.number, 50_000]]);
  const pl = (await getProfitLossReport(FROM, TO)).summary;
  assert.equal(pl.cogs, plBefore.cogs + 600_000 + 700_000 + 1_100_000);
  assert.equal(pl.income, plBefore.income);

  // Once per order: a later cost price change does not book the order again.
  await prisma.product.update({ where: { id: w.panj.id }, data: { costPrice: 900_000 } });
  const later = await rowsHash('Transaction');
  await runTwice('datafix-2026-10-01-cogs-backfill.sql', []);
  assert.equal(await rowsHash('Transaction'), later);
});

test('the COGS account is made as ensureExpenseAccount makes it when there is none', async () => {
  const w = await world();
  await w.order([[w.panj.id, 1, w.shop.id]]);

  await runTwice('datafix-2026-10-01-cogs-backfill.sql', ['Account', 'Transaction']);

  const account = await prisma.account.findFirstOrThrow({ where: { name: COGS_ACCOUNT_NAME } });
  assert.deepEqual([account.type, account.currency, Number(account.balance)], ['EXPENSE', 'TOMAN', 0]);
  const row = await prisma.transaction.findFirstOrThrow({ where: { category: 'COGS' } });
  assert.deepEqual([row.accountId, Number(row.amount)], [account.id, 400_000]);
});
