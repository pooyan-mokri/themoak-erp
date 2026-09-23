import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { createConsignmentPartner, recordConsignmentSales } from '@/actions/consignment';
import { getConsignmentReport } from '@/actions/consignment-reports';
import { getConsignmentCommissionsReport } from '@/actions/consignment-commissions';
import { CHANNELS_FIELD } from '@/lib/consignment-channels';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const COST = 300_000;
const PRICE = 1_000_000;

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/**
 * A partner keeping 30% of what it sells online and 35% in its shop, with
 * three orders: 2 frames online, 1 in the shop, and one more online order
 * turned back into what an order booked before channels looks like.
 */
async function partnerWithSales() {
  const created = await createConsignmentPartner(
    undefined,
    form({
      name: 'همکار',
      [CHANNELS_FIELD]: JSON.stringify([
        { name: 'آنلاین', commissionRate: 30, isDefault: true, isActive: true },
        { name: 'حضوری', commissionRate: 35, isDefault: false, isActive: true },
      ]),
    }),
  );
  assert.equal(created.message, 'همکار امانی با موفقیت ایجاد شد.', created.message);

  const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { isVirtual: true } });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: COST, sellPrice: PRICE } });
  await prisma.inventory.create({ data: { productId: frame.id, warehouseId: warehouse.id, quantity: 20 } });
  await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  const channels = await prisma.consignmentChannel.findMany({
    where: { customerId: warehouse.customerId! },
    orderBy: { sortOrder: 'asc' },
  });
  const channelId = (name: string) => channels.find((channel: any) => channel.name === name)!.id;

  const sell = (saleDate: string, quantity: number, channel: string) =>
    recordConsignmentSales({
      partnerWarehouseId: warehouse.id,
      saleDate,
      items: [{ productId: frame.id, quantity, unitPrice: PRICE, channelId: channelId(channel) }],
    });

  assert.equal((await sell('2026-07-20', 2, 'آنلاین')).success, true);
  assert.equal((await sell('2026-07-20', 1, 'حضوری')).success, true);
  assert.equal((await sell('2026-07-21', 1, 'آنلاین')).success, true);

  // The last one as an order booked before channels existed: no channel on the
  // order, no channel name on its commission, only the rate it was booked at.
  const legacy = await prisma.order.findFirstOrThrow({ orderBy: { number: 'desc' } });
  await prisma.order.update({ where: { id: legacy.id }, data: { consignmentChannelId: null } });
  await prisma.consignmentCommission.updateMany({ where: { orderId: legacy.id }, data: { channelName: null } });

  return { warehouse, legacy };
}

test('the partner report lists the channels and breaks the totals down over them', async () => {
  await partnerWithSales();

  const { partners, grandTotals } = await getConsignmentReport();
  assert.equal(partners.length, 1);
  const [partner] = partners as any[];

  assert.equal(partner.channelSummary, 'آنلاین ۳۰٪ · حضوری ۳۵٪');
  assert.deepEqual(
    partner.channelBreakdown.map((row: any) => [
      row.channel,
      row.commissionRate,
      row.grossSales,
      row.commissions,
      row.netSales,
      row.orderCount,
    ]),
    [
      ['آنلاین', 30, 2_000_000, 600_000, 1_400_000, 1],
      ['حضوری', 35, 1_000_000, 350_000, 650_000, 1],
      // Booked before channels: under «پیش‌فرض», still on the rate it was sold at.
      ['پیش‌فرض', 30, 1_000_000, 300_000, 700_000, 1],
    ],
  );

  // The breakdown adds up to the totals the screen already showed.
  assert.equal(partner.totalSales, 1_400_000 + 650_000 + 700_000);
  assert.equal(partner.totalCommissions, 600_000 + 350_000 + 300_000);
  assert.equal(partner.orderCount, 3);
  assert.equal(grandTotals.totalSales, partner.totalSales);
  assert.equal(grandTotals.totalCommissions, partner.totalCommissions);
});

test('a partner from before channels keeps its one rate on the report', async () => {
  const customer = await prisma.customer.create({ data: { name: 'همکار قدیمی', commissionRate: 10 } });
  const warehouse = await prisma.warehouse.create({
    data: { name: 'انبار امانی - همکار قدیمی', isVirtual: true, customerId: customer.id },
  });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: COST, sellPrice: PRICE } });
  await prisma.inventory.create({ data: { productId: frame.id, warehouseId: warehouse.id, quantity: 10 } });
  assert.equal(
    (await recordConsignmentSales({
      partnerWarehouseId: warehouse.id,
      saleDate: '2026-07-20',
      items: [{ productId: frame.id, quantity: 1, unitPrice: PRICE }],
    })).success,
    true,
  );

  const [partner] = (await getConsignmentReport()).partners as any[];
  assert.equal(partner.channelSummary, '', 'no channels to summarise');
  assert.equal(partner.commissionRate, 10, 'the old badge still has its rate');
  assert.deepEqual(
    partner.channelBreakdown.map((row: any) => [row.channel, row.commissionRate, row.grossSales, row.commissions, row.netSales]),
    [['پیش‌فرض', 10, 1_000_000, 100_000, 900_000]],
  );
});

test('the outstanding report names each order channel and subtotals by channel', async () => {
  await partnerWithSales();

  const { report, grandTotal, totalPartners, totalUnpaidCommissions } = await getConsignmentCommissionsReport();
  assert.equal(report.length, 1);
  const [partner] = report as any[];

  assert.deepEqual(
    [...partner.commissions]
      .sort((a: any, b: any) => a.orderNumber - b.orderNumber)
      .map((row: any) => [row.channelName, row.commissionRate, row.orderAmount, row.commissionAmount]),
    [
      ['آنلاین', 30, 2_000_000, 1_400_000],
      ['حضوری', 35, 1_000_000, 650_000],
      ['پیش‌فرض', 30, 1_000_000, 700_000],
    ],
  );

  // Subtotalled per channel, biggest outstanding first, as the partner cards are.
  assert.deepEqual(
    partner.channelTotals.map((total: any) => [
      total.channel,
      total.commissionRate,
      total.orderCount,
      total.orderAmount,
      total.commissionAmount,
    ]),
    [
      ['آنلاین', 30, 1, 2_000_000, 1_400_000],
      ['پیش‌فرض', 30, 1, 1_000_000, 700_000],
      ['حضوری', 35, 1, 1_000_000, 650_000],
    ],
  );

  assert.equal(partner.totalCommission, 1_400_000 + 700_000 + 650_000);
  assert.equal(partner.totalOrders, 3);
  assert.equal(grandTotal, partner.totalCommission);
  assert.deepEqual([totalPartners, totalUnpaidCommissions], [1, 3]);
});
