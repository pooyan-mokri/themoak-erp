import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import {
  createConsignmentPartner,
  getPendingSettlements,
  recordConsignmentSales,
  updateConsignmentPartner,
} from '@/actions/consignment';
import { returnOrderItem } from '@/actions/order-return';
import { DUPLICATE_REQUEST_MESSAGE } from '@/lib/request-id';
import { CHANNELS_FIELD } from '@/lib/consignment-channels';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const COST = 300_000;
const PRICE = 1_000_000;
const DAY = '2026-07-20';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/** The new contract: the partner keeps 30% of what it sells online and 35% in its shop. */
async function partner(channels = [
  { name: 'آنلاین', commissionRate: 30, isDefault: true, isActive: true },
  { name: 'حضوری', commissionRate: 35, isDefault: false, isActive: true },
]) {
  const created = await createConsignmentPartner(
    undefined,
    form({ name: 'همکار', [CHANNELS_FIELD]: JSON.stringify(channels) }),
  );
  assert.equal(created.message, 'همکار امانی با موفقیت ایجاد شد.', created.message);
  const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { isVirtual: true } });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: COST, sellPrice: PRICE } });
  await prisma.inventory.create({ data: { productId: frame.id, warehouseId: warehouse.id, quantity: 20 } });
  await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  const rows = await prisma.consignmentChannel.findMany({ where: { customerId: warehouse.customerId! }, orderBy: { sortOrder: 'asc' } });
  return { warehouse, frame, channels: rows, customerId: warehouse.customerId! };
}
type Partner = Awaited<ReturnType<typeof partner>>;

const channelId = (p: Partner, name: string) => p.channels.find((channel: any) => channel.name === name)!.id;

function report(p: Partner, items: Array<{ quantity: number; unitPrice?: number; channel?: string }>, extra: { requestId?: string; confirmRepeat?: boolean } = {}) {
  return recordConsignmentSales({
    partnerWarehouseId: p.warehouse.id,
    saleDate: DAY,
    items: items.map((item) => ({
      productId: p.frame.id,
      quantity: item.quantity,
      unitPrice: item.unitPrice ?? PRICE,
      channelId: item.channel ? channelId(p, item.channel) : undefined,
    })),
    ...extra,
  });
}

/** Every consignment order, oldest first, with what it is worth to us. */
async function orders() {
  const rows = await prisma.order.findMany({
    include: { commissions: true, consignmentChannel: true },
    orderBy: { number: 'asc' },
  });
  return rows.map((order: any) => ({
    channel: order.consignmentChannel?.name ?? null,
    net: Number(order.totalAmount),
    gross: Number(order.commissions[0]?.orderAmount ?? 0),
    commission: Number(order.commissions[0]?.commissionAmount ?? 0),
    rate: Number(order.commissions[0]?.commissionRate ?? 0),
    commissionChannel: order.commissions[0]?.channelName ?? null,
  }));
}

const expenses = async (category: string) =>
  (await prisma.transaction.findMany({ where: { category }, orderBy: { createdAt: 'asc' } })).map((row: any) =>
    Number(row.amountInToman),
  );

test('one report over two channels books one order each, at that channel is own rate', async () => {
  const p = await partner();
  assert.equal(
    (await report(p, [
      { quantity: 2, channel: 'آنلاین' },
      { quantity: 1, channel: 'حضوری' },
    ])).success,
    true,
  );

  assert.deepEqual(await orders(), [
    { channel: 'آنلاین', gross: 2_000_000, rate: 30, commission: 600_000, net: 1_400_000, commissionChannel: 'آنلاین' },
    { channel: 'حضوری', gross: 1_000_000, rate: 35, commission: 350_000, net: 650_000, commissionChannel: 'حضوری' },
  ]);
  // Each order books its own cost and commission expense.
  assert.deepEqual(await expenses('COGS'), [600_000, 300_000]);
  assert.deepEqual(await expenses('CONSIGNMENT_COMMISSION'), [600_000, 350_000]);
  assert.equal((await prisma.inventory.findFirstOrThrow()).quantity, 17);
});

test('a later report the same day joins its own channel is order, never the other one', async () => {
  const p = await partner();
  await report(p, [{ quantity: 2, channel: 'آنلاین' }, { quantity: 1, channel: 'حضوری' }]);
  assert.equal((await report(p, [{ quantity: 3, channel: 'حضوری' }])).success, true);

  const booked = await orders();
  assert.equal(booked.length, 2, 'no third order');
  assert.deepEqual(booked[0], { channel: 'آنلاین', gross: 2_000_000, rate: 30, commission: 600_000, net: 1_400_000, commissionChannel: 'آنلاین' });
  // 4 frames in the shop: 4,000,000 gross, 35% of it commission.
  assert.deepEqual(booked[1], { channel: 'حضوری', gross: 4_000_000, rate: 35, commission: 1_400_000, net: 2_600_000, commissionChannel: 'حضوری' });
  // Only the new commission is booked as an expense the second time.
  assert.deepEqual(await expenses('CONSIGNMENT_COMMISSION'), [600_000, 350_000, 1_050_000]);
});

test('a report sent twice with the same id is booked once, over every channel it touches', async () => {
  const p = await partner();
  const twice = { requestId: 'consignment-report-1' };
  assert.equal((await report(p, [{ quantity: 2, channel: 'آنلاین' }, { quantity: 1, channel: 'حضوری' }], twice)).success, true);
  const again = await report(p, [{ quantity: 2, channel: 'آنلاین' }, { quantity: 1, channel: 'حضوری' }], twice);
  assert.equal(again.success, true);
  assert.equal(again.message, DUPLICATE_REQUEST_MESSAGE);

  assert.equal((await orders()).length, 2);
  assert.deepEqual(await expenses('CONSIGNMENT_COMMISSION'), [600_000, 350_000]);
  assert.equal((await prisma.inventory.findFirstOrThrow()).quantity, 17);
});

test('the same lines reported again on one channel ask for confirmation, and book nothing until it comes', async () => {
  const p = await partner();
  await report(p, [{ quantity: 2, channel: 'آنلاین' }]);
  const repeat = await report(p, [{ quantity: 2, channel: 'آنلاین' }, { quantity: 1, channel: 'حضوری' }]);
  assert.match(repeat.message ?? '', /قبلاً در فاکتور #\d+/);
  // The in-store line is not booked either: the whole report waits.
  assert.equal((await orders()).length, 1);
  assert.equal((await prisma.inventory.findFirstOrThrow()).quantity, 18);

  assert.equal((await report(p, [{ quantity: 2, channel: 'آنلاین' }, { quantity: 1, channel: 'حضوری' }], { confirmRepeat: true })).success, true);
  assert.deepEqual((await orders()).map((o: any) => [o.channel, o.gross]), [['آنلاین', 4_000_000], ['حضوری', 1_000_000]]);
});

test('a return reverses the commission of the channel its order was sold through', async () => {
  const p = await partner();
  await report(p, [{ quantity: 2, channel: 'آنلاین' }, { quantity: 2, channel: 'حضوری' }]);
  const account = await prisma.account.findFirstOrThrow();
  for (const order of await prisma.order.findMany({ include: { items: true }, orderBy: { number: 'asc' } })) {
    const returned = await returnOrderItem(
      {},
      form({ orderId: order.id, orderItemId: order.items[0].id, quantity: '1', accountId: account.id, warehouseId: p.warehouse.id }),
    );
    assert.equal(returned.success, true, returned.message);
  }
  // One frame left on each order: 30% off the online one, 35% off the in-store one.
  assert.deepEqual(await orders(), [
    { channel: 'آنلاین', gross: 1_000_000, rate: 30, commission: 300_000, net: 700_000, commissionChannel: 'آنلاین' },
    { channel: 'حضوری', gross: 1_000_000, rate: 35, commission: 350_000, net: 650_000, commissionChannel: 'حضوری' },
  ]);
  const settlements = await getPendingSettlements();
  assert.deepEqual(
    settlements.map((row: any) => [row.commissionRate, row.remainingAmount]).sort(),
    [[30, 700_000], [35, 650_000]].sort(),
  );
});

test('a partner from before channels keeps its rate: the backfill gives it one default channel', async () => {
  // A partner as the old screens made one: a rate on the customer, no channels.
  const customer = await prisma.customer.create({ data: { name: 'همکار قدیمی', commissionRate: 10 } });
  const warehouse = await prisma.warehouse.create({ data: { name: 'انبار امانی - همکار قدیمی', isVirtual: true, customerId: customer.id } });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: COST, sellPrice: PRICE } });
  await prisma.inventory.create({ data: { productId: frame.id, warehouseId: warehouse.id, quantity: 10 } });
  const legacy = { partnerWarehouseId: warehouse.id, saleDate: DAY, items: [{ productId: frame.id, quantity: 1, unitPrice: PRICE }] };
  assert.equal((await recordConsignmentSales(legacy)).success, true);

  const backfill = readFileSync(join(process.cwd(), 'prisma/sql/backfill-consignment-channels.sql'), 'utf8');
  await prisma.$executeRawUnsafe(backfill);
  await prisma.$executeRawUnsafe(backfill); // idempotent: running it again changes nothing

  const channels = await prisma.consignmentChannel.findMany({ where: { customerId: customer.id } });
  assert.deepEqual(
    channels.map((channel: any) => [channel.name, Number(channel.commissionRate), channel.isDefault, channel.isActive]),
    [['پیش‌فرض', 10, true, true]],
  );
  // The order booked before the backfill stays as it was and still reads the same.
  const before = await getPendingSettlements();
  assert.deepEqual(before.map((row: any) => [row.commissionRate, row.grossAmount, row.remainingAmount]), [[10, 1_000_000, 900_000]]);
  assert.equal((await prisma.order.findFirstOrThrow()).consignmentChannelId, null);

  // A report after the backfill computes the same 10%, now on the default channel.
  assert.equal((await recordConsignmentSales({ ...legacy, saleDate: '2026-07-21' })).success, true);
  const booked = await orders();
  assert.deepEqual(booked[1], { channel: 'پیش‌فرض', gross: 1_000_000, rate: 10, commission: 100_000, net: 900_000, commissionChannel: 'پیش‌فرض' });
});

test('the reported unit price is taken as it is, below the system price or above it', async () => {
  const p = await partner();
  assert.equal((await report(p, [{ quantity: 1, unitPrice: 250_000, channel: 'آنلاین' }])).success, true);
  assert.equal((await report(p, [{ quantity: 1, unitPrice: 4_000_000, channel: 'حضوری' }])).success, true);
  assert.deepEqual((await orders()).map((o: any) => [o.gross, o.commission, o.net]), [
    [250_000, 75_000, 175_000],
    [4_000_000, 1_400_000, 2_600_000],
  ]);
});

test('a channel of another partner, or a deactivated one, is refused', async () => {
  const p = await partner();
  const other = await createConsignmentPartner(
    undefined,
    form({ name: 'همکار دیگر', [CHANNELS_FIELD]: JSON.stringify([{ name: 'آنلاین', commissionRate: 20, isDefault: true, isActive: true }]) }),
  );
  assert.equal(other.message, 'همکار امانی با موفقیت ایجاد شد.');
  const theirs = await prisma.consignmentChannel.findFirstOrThrow({ where: { customerId: { not: p.customerId } } });
  const refused = await recordConsignmentSales({
    partnerWarehouseId: p.warehouse.id,
    saleDate: DAY,
    items: [{ productId: p.frame.id, quantity: 1, unitPrice: PRICE, channelId: theirs.id }],
  });
  assert.match(refused.message ?? '', /کانال فروش انتخاب‌شده/);
  assert.equal(await prisma.order.count(), 0);

  // Closing a channel keeps its orders but refuses new sales through it.
  await report(p, [{ quantity: 1, channel: 'حضوری' }]);
  const closed = await updateConsignmentPartner(
    p.warehouse.id,
    undefined,
    form({ name: 'همکار', [CHANNELS_FIELD]: JSON.stringify([{ id: channelId(p, 'آنلاین'), name: 'آنلاین', commissionRate: 30, isDefault: true, isActive: true }]) }),
  );
  assert.equal(closed.success, true, closed.message);
  const shop = await prisma.consignmentChannel.findFirstOrThrow({ where: { name: 'حضوری' } });
  assert.equal(shop.isActive, false, 'a channel with orders is closed, not deleted');
  assert.match((await report(p, [{ quantity: 1, channel: 'حضوری' }])).message ?? '', /کانال فروش انتخاب‌شده/);
});
