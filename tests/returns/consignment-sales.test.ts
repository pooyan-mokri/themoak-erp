import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import {
  createConsignmentPartner,
  deleteConsignmentOrder,
  getPartnerStatement,
  getPendingSettlements,
  markSettlementPaidOutside,
  paySettlement,
  recordConsignmentSales,
  updateConsignmentPartner,
} from '@/actions/consignment';
import { getConsignmentCommissionsReport } from '@/actions/consignment-commissions';
import { getConsignmentReport } from '@/actions/consignment-reports';
import { CHANNELS_FIELD } from '@/lib/consignment-channels';
import { WEBSITE_ORDER_LOCKED } from '@/lib/site-sale-data';
import { INVALID_RECEIPT_MESSAGE } from '@/lib/receipt-ref';
import { localDateString } from '@/lib/date-utils';
import { DENIED, NON_SELLERS, assertInvariants, balanceOf, openAccount, quantityOf, sleep, snapshot, stockIn } from '../sales/world';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const COST = 300_000;
const PRICE = 1_000_000;
const DAY = '2026-09-20';
/** The calendar day an instant falls on in Tehran. */
const tehranDay = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' });

beforeEach(async () => {
  beforeQuery.fn = null;
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/** A partner keeping 30% online and 35% in its shop, holding 20 frames sent from our shop; a bank. */
async function world() {
  await prisma.user.create({ data: { id: 'test-user', name: 'Test', email: 'test@example.com', password: 'x' } });
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
  assert.equal(created.message, 'همکار امانی با موفقیت ایجاد شد.');
  const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { isVirtual: true } });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: COST, sellPrice: PRICE } });
  await stockIn(frame.id, warehouse.id, 20);
  const bank = await openAccount('بانک', { opening: 1_000_000 });
  const channels = await prisma.consignmentChannel.findMany({ where: { customerId: warehouse.customerId! } });
  const channel = (name: string) => channels.find((c: any) => c.name === name)!;
  return { warehouse, frame, bank, customerId: warehouse.customerId!, channel };
}
type World = Awaited<ReturnType<typeof world>>;

function report(w: World, quantity: number, extra: { channel?: string; unitPrice?: number; saleDate?: string; requestId?: string } = {}) {
  return recordConsignmentSales({
    partnerWarehouseId: w.warehouse.id,
    saleDate: extra.saleDate ?? DAY,
    items: [{ productId: w.frame.id, quantity, unitPrice: extra.unitPrice ?? PRICE, channelId: extra.channel ? w.channel(extra.channel).id : undefined }],
    requestId: extra.requestId,
  });
}

async function setRate(w: World, name: string, rate: number) {
  const rows = await prisma.consignmentChannel.findMany({ where: { customerId: w.customerId }, orderBy: { sortOrder: 'asc' } });
  const result = await updateConsignmentPartner(
    w.warehouse.id,
    undefined,
    form({
      name: 'همکار',
      [CHANNELS_FIELD]: JSON.stringify(
        rows.map((c: any) => ({ id: c.id, name: c.name, commissionRate: c.name === name ? rate : Number(c.commissionRate), isDefault: c.isDefault, isActive: c.isActive })),
      ),
    }),
  );
  assert.equal(result.success, true, result.message);
}

const orders = async () =>
  (await prisma.order.findMany({ include: { commissions: true, consignmentChannel: true, items: true }, orderBy: { number: 'asc' } })).map((o: any) => ({
    channel: o.consignmentChannel?.name ?? null,
    units: o.items.reduce((sum: number, item: any) => sum + item.quantity, 0),
    net: Number(o.totalAmount),
    rate: Number(o.commissions[0]?.commissionRate ?? 0),
    commission: Number(o.commissions[0]?.commissionAmount ?? 0),
    status: o.paymentStatus,
  }));
const expenses = async (category: string) =>
  (await prisma.transaction.findMany({ where: { category }, orderBy: { createdAt: 'asc' } })).map((row: any) => Number(row.amount));

// --- recording what the partner sold ---

test('a report books the order net of the commission, the commission at the rate of the day, COGS, SALE movements and stock', async () => {
  const w = await world();
  const result = await report(w, 3, { channel: 'حضوری' });
  assert.deepEqual(result, { message: 'فروش‌های امانی با موفقیت ثبت شد.', success: true });

  const order = await prisma.order.findFirstOrThrow({ include: { commissions: true, items: true } });
  assert.deepEqual(
    [Number(order.totalAmount), Number(order.paidAmount), order.paymentStatus, order.status, order.customerId, tehranDay(order.createdAt)],
    [3 * PRICE * 0.65, 0, 'UNPAID', 'COMPLETED', w.customerId, DAY],
  );
  const [commission] = order.commissions;
  assert.deepEqual(
    [Number(commission.orderAmount), Number(commission.commissionRate), Number(commission.commissionAmount), commission.channelName, commission.isPaid],
    [3 * PRICE, 35, 3 * PRICE * 0.35, 'حضوری', true],
  );
  // Commission = gross × rate, and the partner's net = gross − commission.
  assert.equal(Number(commission.orderAmount) - Number(commission.commissionAmount), Number(order.totalAmount));
  assert.deepEqual(await expenses('COGS'), [3 * COST]);
  assert.deepEqual(await expenses('CONSIGNMENT_COMMISSION'), [3 * PRICE * 0.35]);
  const movement = await prisma.inventoryMovement.findFirstOrThrow({ where: { type: 'SALE' } });
  assert.deepEqual([movement.fromWarehouseId, movement.quantity, movement.referenceId], [w.warehouse.id, 3, order.id]);
  assert.equal(await quantityOf(w.frame.id, w.warehouse.id), 17);
  await assertInvariants();
});

test('a commission booked stays at its rate: after the channel rate changes, the same day\'s sales go on a new order at the new rate', async () => {
  const w = await world();
  assert.equal((await report(w, 2, { channel: 'آنلاین' })).success, true);

  await setRate(w, 'آنلاین', 40);
  assert.equal((await report(w, 1, { channel: 'آنلاین' })).success, true);
  await setRate(w, 'آنلاین', 10);
  assert.equal((await report(w, 1, { channel: 'آنلاین' })).success, true);
  // Another sale at 10% the same day joins the 10% order.
  assert.equal((await report(w, 3, { channel: 'آنلاین' })).success, true);

  assert.deepEqual(await orders(), [
    { channel: 'آنلاین', units: 2, net: 1_400_000, rate: 30, commission: 600_000, status: 'UNPAID' },
    { channel: 'آنلاین', units: 1, net: 600_000, rate: 40, commission: 400_000, status: 'UNPAID' },
    { channel: 'آنلاین', units: 4, net: 3_600_000, rate: 10, commission: 400_000, status: 'UNPAID' },
  ]);
  // Each commission expense row is what its own sale incurred: they add up to the commissions booked.
  assert.deepEqual(await expenses('CONSIGNMENT_COMMISSION'), [600_000, 400_000, 100_000, 300_000]);
  const settlements = await getPendingSettlements();
  assert.deepEqual(settlements.map((s: any) => [s.commissionRate, s.remainingAmount]).sort(), [[10, 3_600_000], [30, 1_400_000], [40, 600_000]]);
  await assertInvariants();
});

test('a line reported at a price of 0 owes nothing: its order is booked settled and never waits in the settlement list', async () => {
  const w = await world();
  assert.equal((await report(w, 1, { unitPrice: 0 })).success, true);
  const [order] = await orders();
  assert.deepEqual(order, { channel: 'آنلاین', units: 1, net: 0, rate: 30, commission: 0, status: 'PAID' });
  assert.deepEqual(await getPendingSettlements(), []);
  assert.deepEqual(await expenses('COGS'), [COST], 'the frame still left at its cost');
  assert.equal(await quantityOf(w.frame.id, w.warehouse.id), 19);
  await assertInvariants();
});

test('a day picked in the Jalali calendar is the day the sale and its settlement are booked on, in Tehran', async () => {
  process.env.TZ = 'Asia/Tehran';
  const w = await world();
  // Picking 1405/07/05 gives its local midnight: 20:30 UTC on 26 Sept.
  const picked = new Date('2026-09-26T20:30:00.000Z');
  assert.equal(picked.toISOString().slice(0, 10), '2026-09-26', 'the UTC day the forms used to send');
  assert.equal(localDateString(picked), '2026-09-27');
  assert.equal(localDateString(new Date('2026-09-27T20:29:59.000Z')), '2026-09-27', '23:59 in Tehran is still that day');

  assert.equal((await report(w, 1, { saleDate: localDateString(picked) })).success, true);
  const order = await prisma.order.findFirstOrThrow();
  assert.equal(tehranDay(order.createdAt), '2026-09-27');
  assert.equal((await paySettlement(undefined, form({ orderId: order.id, accountId: w.bank.id, paymentDate: localDateString(picked) }))).success, true);
  const income = await prisma.transaction.findFirstOrThrow({ where: { type: 'INCOME' } });
  assert.equal(tehranDay(income.date), '2026-09-27');
});

test('sales on different days are different orders; a day whose order was cancelled starts a new one', async () => {
  const w = await world();
  await report(w, 1, { saleDate: '2026-09-20' });
  await report(w, 1, { saleDate: '2026-09-21' });
  const [first] = await prisma.order.findMany({ orderBy: { number: 'asc' } });
  await prisma.order.update({ where: { id: first.id }, data: { status: 'CANCELLED' } });
  await report(w, 2, { saleDate: '2026-09-20' });
  const rows = await prisma.order.findMany({ include: { items: true }, orderBy: { number: 'asc' } });
  assert.deepEqual(
    rows.map((o: any) => [tehranDay(o.createdAt), o.status, o.items.length]),
    [['2026-09-20', 'CANCELLED', 1], ['2026-09-21', 'COMPLETED', 1], ['2026-09-20', 'COMPLETED', 1]],
  );
});

test('two reports for one partner at the same moment run one after the other: the second sees the stock the first took', async () => {
  const w = await world();
  beforeQuery.fn = async (params) => {
    if (params.model === 'Order' && params.action === 'create') await sleep(150);
  };
  const results = await Promise.all([
    report(w, 15, { requestId: 'consignment-race-01' }),
    report(w, 10, { channel: 'حضوری', requestId: 'consignment-race-02' }),
  ]);
  beforeQuery.fn = null;
  assert.deepEqual(results.map((r) => r.success === true).sort(), [false, true]);
  assert.match(results.find((r) => !r.success)!.message ?? '', /موجودی کافی نیست/);
  assert.equal(await prisma.order.count(), 1);
  assert.ok((await quantityOf(w.frame.id, w.warehouse.id)) >= 5);
  await assertInvariants();
});

test('a report that fails half way leaves no order, no commission, no expense, no movement and the stock as it was', async () => {
  const w = await world();
  const before = await snapshot();
  beforeQuery.fn = async (params) => {
    if (params.model === 'Transaction' && params.action === 'create' && (params.args as any)?.data?.category === 'CONSIGNMENT_COMMISSION') {
      throw new Error('simulated failure');
    }
  };
  const result = await recordConsignmentSales({
    partnerWarehouseId: w.warehouse.id,
    saleDate: DAY,
    items: [
      { productId: w.frame.id, quantity: 1, unitPrice: PRICE, channelId: w.channel('آنلاین').id },
      { productId: w.frame.id, quantity: 1, unitPrice: PRICE, channelId: w.channel('حضوری').id },
    ],
    requestId: 'consignment-fail-01',
  });
  beforeQuery.fn = null;
  assert.equal(result.success, undefined);
  assert.deepEqual(await snapshot(), before);
  // The same report then goes through whole, once.
  assert.equal((await recordConsignmentSales({
    partnerWarehouseId: w.warehouse.id,
    saleDate: DAY,
    items: [{ productId: w.frame.id, quantity: 1, unitPrice: PRICE, channelId: w.channel('آنلاین').id }],
    requestId: 'consignment-fail-01',
  })).success, true);
  assert.equal(await prisma.order.count(), 1);
});

test('a report that is not whole units, has no lines, has a negative price, names no partner warehouse or wants more than it holds is refused', async () => {
  const w = await world();
  const store = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const before = await snapshot();
  const invalid = 'لطفا فیلدها را به درستی پر کنید.';
  assert.equal((await report(w, 1.5)).message, invalid);
  assert.equal((await report(w, 0)).message, invalid);
  assert.equal((await report(w, 1, { unitPrice: -1 })).message, invalid);
  assert.equal((await report(w, 1, { saleDate: '' })).message, invalid);
  assert.equal((await report(w, 1, { saleDate: 'نامعتبر' })).message, 'تاریخ فروش نامعتبر است.');
  assert.equal((await recordConsignmentSales({ partnerWarehouseId: w.warehouse.id, saleDate: DAY, items: [] })).message, invalid);
  const notPartner = await recordConsignmentSales({ partnerWarehouseId: store.id, saleDate: DAY, items: [{ productId: w.frame.id, quantity: 1, unitPrice: PRICE }] });
  assert.equal(notPartner.message, 'انبار همکار یا مشتری مرتبط یافت نشد.');
  assert.equal((await report(w, 21)).message, 'موجودی کافی نیست برای محصول PANJ (موجودی: 20, درخواست: 21)');
  for (const role of NON_SELLERS) {
    setTestRole(role);
    assert.equal((await report(w, 1)).message, DENIED, String(role));
  }
  assert.deepEqual(await snapshot(), before);
});

// --- settling ---

test('a settlement paid in parts: PARTIAL, then PAID at the net, on the day given, with its receipt', async () => {
  const w = await world();
  await report(w, 2); // 1,400,000 owed
  const order = await prisma.order.findFirstOrThrow();
  const pay = (fields: Record<string, string>) => paySettlement(undefined, form({ orderId: order.id, accountId: w.bank.id, ...fields }));

  assert.deepEqual(await pay({ amount: '400000', paymentDate: '2026-09-22', receiptUrl: 'ftp:/receipts/0f8fad5b-d9cb-469f-a165-70867728950e.png' }), { message: 'پرداخت با موفقیت ثبت شد.', success: true });
  let now = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.deepEqual([Number(now.paidAmount), now.paymentStatus, now.transactionId], [400_000, 'PARTIAL', null]);
  const [first] = await prisma.transaction.findMany({ where: { type: 'INCOME' } });
  assert.deepEqual(
    [first.date.toISOString().slice(0, 10), first.orderId, first.customerId, first.description],
    ['2026-09-22', order.id, w.customerId, `تسویه فروش امانی - سفارش #${order.number} (پرداخت جزئی)`],
  );

  const before = await snapshot();
  assert.match((await pay({ amount: '1000001' })).message ?? '', /از مبلغ باقیمانده/);
  assert.equal((await pay({ amount: '0' })).message, 'اطلاعات پرداخت نامعتبر است.');
  assert.equal((await pay({ amount: '-5' })).message, 'اطلاعات پرداخت نامعتبر است.');
  assert.equal((await pay({ receiptUrl: 'https://evil.example/r.png' })).message, INVALID_RECEIPT_MESSAGE);
  assert.equal((await pay({ paymentDate: 'نامعتبر' })).message, 'تاریخ پرداخت نامعتبر است.');
  assert.equal((await paySettlement(undefined, form({ orderId: 'no-such-order', accountId: w.bank.id }))).message, 'سفارش یافت نشد.');
  assert.equal((await paySettlement(undefined, form({ orderId: order.id, accountId: 'no-such-account' }))).message, 'حساب مقصد یافت نشد.');
  assert.deepEqual(await snapshot(), before);

  // No amount: the 1,000,000 left.
  assert.equal((await pay({})).success, true);
  now = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  const last = await prisma.transaction.findFirstOrThrow({ where: { type: 'INCOME' }, orderBy: { createdAt: 'desc' } });
  assert.deepEqual([Number(now.paidAmount), now.paymentStatus, Number(now.totalAmount), now.transactionId], [1_400_000, 'PAID', 1_400_000, last.id]);
  assert.equal(await balanceOf(w.bank.id), 1_000_000 + 1_400_000);
  assert.equal((await pay({ amount: '1' })).message, 'این سفارش قبلاً به طور کامل پرداخت شده است.');
  assert.deepEqual(await getPendingSettlements(), []);
  await assertInvariants();
});

test('a website order is never settled or closed here', async () => {
  const w = await world();
  await report(w, 1);
  const order = await prisma.order.findFirstOrThrow();
  await prisma.order.update({ where: { id: order.id }, data: { siteReference: 'M-SITE-1' } });
  const before = await snapshot();
  assert.equal((await paySettlement(undefined, form({ orderId: order.id, accountId: w.bank.id }))).message, WEBSITE_ORDER_LOCKED);
  assert.equal((await markSettlementPaidOutside(order.id, 700_000)).message, WEBSITE_ORDER_LOCKED);
  assert.equal((await deleteConsignmentOrder(order.id)).message, WEBSITE_ORDER_LOCKED);
  assert.deepEqual(await snapshot(), before);
  // Nor does it count as owed by the partner, on any screen.
  assert.deepEqual(await getPendingSettlements(), []);
  assert.equal((await getConsignmentCommissionsReport()).grandTotal, 0);
});

test('closing outside the ERP: unknown or cancelled invoices are refused', async () => {
  const w = await world();
  await report(w, 1);
  const order = await prisma.order.findFirstOrThrow();
  assert.equal((await markSettlementPaidOutside('no-such-order', 1)).message, 'فاکتور یافت نشد.');
  await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
  assert.equal((await markSettlementPaidOutside(order.id, 700_000)).message, 'این فاکتور لغو شده است.');
});

test('deleting a report order puts its frames back at the partner and removes its SALE movements, COGS and commission rows', async () => {
  const w = await world();
  await report(w, 3);
  const order = await prisma.order.findFirstOrThrow();
  assert.equal((await deleteConsignmentOrder(order.id)).success, true);
  assert.equal(await quantityOf(w.frame.id, w.warehouse.id), 20);
  assert.deepEqual([await prisma.order.count(), await prisma.transaction.count({ where: { orderId: { not: null } } }), await prisma.consignmentCommission.count()], [0, 0, 0]);
  assert.equal(await prisma.inventoryMovement.count({ where: { type: 'SALE' } }), 0);

  const ordinary = await prisma.order.create({ data: { totalAmount: 1, customerId: (await prisma.customer.create({ data: { name: 'سارا' } })).id } });
  assert.equal((await deleteConsignmentOrder(ordinary.id)).message, 'این سفارش یک فاکتور امانی نیست.');
  assert.equal((await deleteConsignmentOrder('no-such-order')).message, 'سفارش یافت نشد.');
});

// --- the screens that show what a partner owes ---

test('the settlement list, the outstanding report, the partner report and the statement show the same amount owed', async () => {
  const w = await world();
  await report(w, 2, { channel: 'آنلاین' }); // 1,400,000
  await report(w, 1, { channel: 'حضوری' }); // 650,000
  await report(w, 1, { channel: 'آنلاین', saleDate: '2026-09-21' }); // 700,000, then cancelled
  await report(w, 1, { channel: 'حضوری', saleDate: '2026-09-22' }); // 650,000, stored gross as older orders were
  const [online, shop, cancelled, legacy] = await prisma.order.findMany({ orderBy: { number: 'asc' } });
  assert.equal((await paySettlement(undefined, form({ orderId: online.id, accountId: w.bank.id, amount: '400000' }))).success, true);
  await prisma.order.update({ where: { id: cancelled.id }, data: { status: 'CANCELLED' } });
  await prisma.order.update({ where: { id: legacy.id }, data: { totalAmount: PRICE } });

  const owed = 1_000_000 + 650_000 + 650_000;
  const pending = await getPendingSettlements();
  assert.equal(pending.reduce((sum: number, s: any) => sum + s.remainingAmount, 0), owed);
  assert.equal((await getConsignmentCommissionsReport()).grandTotal, owed);
  assert.equal((await getPartnerStatement(w.warehouse.id))!.financials.balance, owed);
  const { partners, grandTotals } = await getConsignmentReport();
  const [partner] = partners as any[];
  assert.deepEqual([partner.totalSales, partner.totalPaid, partner.totalDebt, grandTotals.totalDebt], [1_400_000 + 650_000 + 650_000, 400_000, owed, owed]);
  // A cancelled order is no sale and carries no commission.
  assert.equal(partner.orderCount, 3);
  assert.equal(partner.totalCommissions, 600_000 + 350_000 + 350_000);
  assert.deepEqual(
    partner.channelBreakdown.map((row: any) => [row.channel, row.grossSales, row.commissions, row.netSales, row.orderCount]),
    [['آنلاین', 2_000_000, 600_000, 1_400_000, 1], ['حضوری', 2_000_000, 700_000, 1_300_000, 2]],
  );
  // The shop's order under its channel, the online one partly paid, the statement's channel split.
  assert.deepEqual(pending.map((s: any) => [s.number, s.channelName, s.remainingAmount]).sort(), [
    [online.number, 'آنلاین', 1_000_000],
    [shop.number, 'حضوری', 650_000],
    [legacy.number, 'حضوری', 650_000],
  ].sort());
  const statement = (await getPartnerStatement(w.warehouse.id))!;
  assert.deepEqual(statement.financials.byChannel.map((row: any) => [row.channel, row.gross, row.commission, row.net]).sort(), [
    ['آنلاین', 2_000_000, 600_000, 1_400_000],
    ['حضوری', 2_000_000, 700_000, 1_300_000],
  ]);
  assert.deepEqual([statement.financials.grossSales, statement.financials.commissionTotal, statement.financials.ourShare, statement.financials.receivedTotal], [4_000_000, 1_300_000, 2_700_000, 400_000]);
});
