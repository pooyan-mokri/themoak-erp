import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { prisma, resetDatabase } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { closePurchaseOrderShort, getPurchaseOrder, getSuppliers, receivePurchaseOrderItems } from '@/actions/supplier';
import { payPurchaseOrderFromCredit, recordArrival, recordPurchasePartialPayment, recordPurchasePayment, updatePurchaseOrderStatus } from '@/actions/supplier-workflow';
import { DUPLICATE_REQUEST_MESSAGE } from '@/lib/request-id';
import { balanceOf } from '../accounting/ledger';
import { OPENING, assertPurchaseInvariants, order, purchasingWorld, type World } from './world';

// Pooyan's decision: cancelling a purchase order that has payments turns what was paid into a credit with the
// supplier («طلب از تأمین‌کننده»), which later pays another order of the same supplier without moving any account.

console.error = () => {};

const DENIED = 'شما به این بخش دسترسی ندارید.';
let w: World;

beforeEach(async () => {
  setTestRole('ADMIN');
  beforeQuery.fn = null;
  await resetDatabase();
  await prisma.user.create({ data: { id: 'test-user', name: 'Owner', email: 'owner@x.test', password: 'x', role: 'ADMIN' } });
  w = await purchasingWorld();
});
after(() => prisma.$disconnect());

const balance = async (supplierId = w.supplier.id) =>
  Number((await prisma.supplierCredit.aggregate({ where: { supplierId }, _sum: { amount: true } }))._sum.amount ?? 0);
const statusOf = async (id: string) => (await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } })).status;
/** 10 frames at 100,000 plus 200,000 freight: 1,200,000 toman. */
const tenFrames = (status = 'PENDING_PAYMENT', supplierId?: string) =>
  order({ ...w, supplier: supplierId ? { ...w.supplier, id: supplierId } : w.supplier }, [{ productId: w.panj.id, quantity: 10, unitCost: 100_000 }], [{ title: 'حمل', amount: 200_000, currency: 'TOMAN' }], status);

/** An order paid 300,000 from the Toman bank and 500,000 from the dollar account, then cancelled: 800,000 of credit. */
async function cancelledWithCredit() {
  const po = await tenFrames();
  await recordPurchasePartialPayment({ orderId: po.id, accountId: 'toman', amount: 300_000 });
  await recordPurchasePartialPayment({ orderId: po.id, accountId: 'usd', amount: 500_000 });
  const cancelled = await updatePurchaseOrderStatus(po.id, 'CANCELLED', 800_000);
  assert.deepEqual(cancelled, { success: true, message: 'سفارش لغو شد و ۸۰۰٬۰۰۰ تومان پرداخت‌شده به طلب از تأمین‌کننده «Mazzucchelli» اضافه شد.' });
  return po;
}

// --- cancel ---

test('cancelling a paid order credits the supplier with what was paid, in Toman, once', async () => {
  const po = await cancelledWithCredit();
  const credits = await prisma.supplierCredit.findMany();
  assert.deepEqual(
    credits.map((c: any) => [c.supplierId, Number(c.amount), c.purchaseOrderId, c.reason, c.userId, c.clientRequestId]),
    [[w.supplier.id, 800_000, po.id, `لغو سفارش خرید #${po.number}`, 'test-user', `po-cancel:${po.id}`]],
  );
  assert.equal(await statusOf(po.id), 'CANCELLED');
  // The money that left the accounts stays spent; nothing moves back.
  assert.deepEqual([await balanceOf('toman'), await balanceOf('usd')], [OPENING.toman - 300_000, OPENING.usd - 5]);
  // Submitted again: refused, and still one credit.
  assert.equal((await updatePurchaseOrderStatus(po.id, 'CANCELLED', 800_000)).success, false);
  assert.equal(await balance(), 800_000);
  await assertPurchaseInvariants();
});

test('a double submitted cancel, at the same moment, credits once', async () => {
  const po = await tenFrames();
  await recordPurchasePartialPayment({ orderId: po.id, accountId: 'toman', amount: 400_000 });
  const results = await Promise.all([updatePurchaseOrderStatus(po.id, 'CANCELLED', 400_000), updatePurchaseOrderStatus(po.id, 'CANCELLED', 400_000)]);
  assert.deepEqual(results.map((r) => r.success).sort(), [false, true]);
  assert.equal(await prisma.supplierCredit.count(), 1);
  assert.equal(await balance(), 400_000);
  await assertPurchaseInvariants();
});

test('a cancel with no payments creates no credit; one whose payments changed since the page showed them does nothing', async () => {
  const unpaid = await tenFrames();
  assert.deepEqual(await updatePurchaseOrderStatus(unpaid.id, 'CANCELLED', 0), { success: true, message: 'وضعیت سفارش به‌روزرسانی شد' });
  const draft = await tenFrames('DRAFT');
  assert.equal((await updatePurchaseOrderStatus(draft.id, 'CANCELLED')).success, true);
  assert.equal(await prisma.supplierCredit.count(), 0);

  const paid = await tenFrames();
  await recordPurchasePartialPayment({ orderId: paid.id, accountId: 'toman', amount: 100_000 });
  const stale = await updatePurchaseOrderStatus(paid.id, 'CANCELLED', 0);
  assert.equal(stale.success, false);
  assert.match(stale.message!, /تغییر کرده است/);
  assert.equal(await statusOf(paid.id), 'PARTIALLY_PAID');
  assert.equal(await prisma.supplierCredit.count(), 0);
  await assertPurchaseInvariants();
});

// --- using the credit ---

test('the credit pays a later order of the same supplier: a payment with no account and no transaction', async () => {
  await cancelledWithCredit();
  const next = await tenFrames();
  const transactions = await prisma.transaction.count();
  const paid = await payPurchaseOrderFromCredit({ orderId: next.id, requestId: 'credit-use-0001' });
  assert.deepEqual(paid, { success: true, message: '۸۰۰٬۰۰۰ تومان از طلب تأمین‌کننده پرداخت شد. باقیمانده: ۴۰۰٬۰۰۰ تومان' });
  const payment = await prisma.purchaseOrderPayment.findFirstOrThrow({ where: { purchaseOrderId: next.id } });
  assert.deepEqual([Number(payment.amount), payment.accountId, payment.transactionId, payment.description], [800_000, null, null, 'از طلب تأمین‌کننده']);
  assert.equal(await prisma.transaction.count(), transactions, 'no account moves');
  assert.deepEqual([await balanceOf('toman'), await balanceOf('usd')], [OPENING.toman - 300_000, OPENING.usd - 5]);
  assert.equal(await balance(), 0);
  assert.equal(await statusOf(next.id), 'PARTIALLY_PAID');
  const used = await prisma.supplierCredit.findUniqueOrThrow({ where: { clientRequestId: 'credit-use-0001' } });
  assert.deepEqual([Number(used.amount), used.purchaseOrderId], [-800_000, next.id]);

  // The rest is paid from an account as usual, and the order is settled.
  assert.equal((await recordPurchasePartialPayment({ orderId: next.id, accountId: 'toman', amount: 400_000 })).success, true);
  assert.equal(await statusOf(next.id), 'PAID');
  await assertPurchaseInvariants();
});

test('the cap: never more than the credit nor more than what remains; an amount inside it is paid as asked', async () => {
  await cancelledWithCredit(); // 800,000 of credit
  const small = await order(w, [{ productId: w.panj.id, quantity: 1, unitCost: 500_000 }], [], 'PENDING_PAYMENT');
  // More than remains (500,000): refused; the default pays what remains, and the credit keeps the rest.
  assert.deepEqual(await payPurchaseOrderFromCredit({ orderId: small.id, amount: 600_000 }), {
    success: false,
    message: 'مبلغ از طلب قابل استفاده بیشتر است. حداکثر: ۵۰۰٬۰۰۰ تومان',
  });
  assert.equal((await payPurchaseOrderFromCredit({ orderId: small.id })).success, true);
  assert.deepEqual([await statusOf(small.id), await balance()], ['PAID', 300_000]);

  // More than the credit (300,000) on a bigger order: refused; 100,000 of it is paid as asked; within 1 toman over
  // the cap is capped.
  const big = await tenFrames();
  assert.match((await payPurchaseOrderFromCredit({ orderId: big.id, amount: 300_002 })).message!, /حداکثر: ۳۰۰٬۰۰۰ تومان/);
  assert.equal((await payPurchaseOrderFromCredit({ orderId: big.id, amount: 100_000 })).success, true);
  assert.equal((await payPurchaseOrderFromCredit({ orderId: big.id, amount: 200_000.5 })).success, true);
  const payments = await prisma.purchaseOrderPayment.findMany({ where: { purchaseOrderId: big.id }, orderBy: { amount: 'asc' } });
  assert.deepEqual(payments.map((p: any) => Number(p.amount)), [100_000, 200_000]);
  assert.equal(await balance(), 0);
  assert.deepEqual(await payPurchaseOrderFromCredit({ orderId: big.id }), { success: false, message: 'از این تأمین‌کننده طلبی ثبت نشده است.' });
  await assertPurchaseInvariants();
});

test('the same submission pays once, whether repeated later or at the same moment', async () => {
  await cancelledWithCredit();
  const next = await tenFrames();
  const pay = () => payPurchaseOrderFromCredit({ orderId: next.id, amount: 100_000, requestId: 'credit-use-0002' });
  const results = await Promise.all([pay(), pay()]);
  assert.ok(results.every((r) => r.success), JSON.stringify(results));
  assert.equal((await pay()).message, DUPLICATE_REQUEST_MESSAGE);
  assert.equal(await prisma.purchaseOrderPayment.count({ where: { purchaseOrderId: next.id } }), 1);
  assert.equal(await balance(), 700_000);
  await assertPurchaseInvariants();
});

test('two orders using the same credit at once cannot spend more than it holds', async () => {
  await cancelledWithCredit(); // 800,000
  const a = await tenFrames();
  const b = await tenFrames();
  let second: Promise<any> | null = null;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'PurchaseOrderPayment' || params.action !== 'create') return;
    beforeQuery.fn = null;
    second = payPurchaseOrderFromCredit({ orderId: b.id });
    await Promise.race([second, sleep(500)]);
  };
  const first = await payPurchaseOrderFromCredit({ orderId: a.id });
  beforeQuery.fn = null;
  assert.equal(first.success, true);
  assert.deepEqual(await second!, { success: false, message: 'از این تأمین‌کننده طلبی ثبت نشده است.' });
  assert.equal(await balance(), 0);
  await assertPurchaseInvariants();
});

test('the credit is the supplier\'s own; orders that are not awaiting payment and roles without finance.manage are refused', async () => {
  await cancelledWithCredit();
  const other = await prisma.supplier.create({ data: { name: 'Safilo' } });
  const theirs = await tenFrames('PENDING_PAYMENT', other.id);
  assert.deepEqual(await payPurchaseOrderFromCredit({ orderId: theirs.id }), { success: false, message: 'از این تأمین‌کننده طلبی ثبت نشده است.' });
  for (const status of ['DRAFT', 'PAID', 'ARRIVED', 'CANCELLED']) {
    const po = await tenFrames(status);
    assert.deepEqual(await payPurchaseOrderFromCredit({ orderId: po.id }), { success: false, message: 'این سفارش در وضعیت قابل پرداخت نیست' }, status);
  }
  const mine = await tenFrames();
  assert.deepEqual(await payPurchaseOrderFromCredit({ orderId: mine.id, amount: 0 }), { success: false, message: 'مبلغ پرداخت باید بیشتر از صفر باشد.' });
  assert.deepEqual(await payPurchaseOrderFromCredit({ orderId: 'missing' }), { success: false, message: 'سفارش یافت نشد' });
  for (const role of ['AUDITOR', 'SALES', 'WAREHOUSE', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    assert.equal((await payPurchaseOrderFromCredit({ orderId: mine.id })).message, DENIED, String(role));
  }
  assert.equal(await balance(), 800_000);
  assert.equal(await prisma.purchaseOrderPayment.count({ where: { accountId: null } }), 0);
});

test('cancelling an order that was paid from the credit gives the credit back', async () => {
  await cancelledWithCredit();
  const next = await tenFrames();
  await payPurchaseOrderFromCredit({ orderId: next.id, amount: 500_000 });
  await recordPurchasePartialPayment({ orderId: next.id, accountId: 'toman', amount: 100_000 });
  assert.equal(await balance(), 300_000);
  assert.equal((await updatePurchaseOrderStatus(next.id, 'CANCELLED', 600_000)).success, true);
  assert.equal(await balance(), 900_000);
  await assertPurchaseInvariants();
});

// --- closing a short shipment ---

/** 10 frames at 100,000 plus 200,000 freight on the order and 50,000 of arrival costs, paid in full, 8 arrived. */
async function paidShortOrder() {
  const po = await tenFrames();
  assert.equal((await recordPurchasePayment(po.id, 'toman')).success, true);
  assert.equal((await updatePurchaseOrderStatus(po.id, 'IN_PRODUCTION')).success, true);
  assert.equal((await recordArrival(po.id, [{ title: 'ترخیص', amount: 50_000, currency: 'TOMAN' }], 'toman')).success, true);
  assert.equal((await receivePurchaseOrderItems(po.id, w.main.id, [{ itemId: po.items[0].id, receivedQuantity: 8 }])).success, true);
  return po;
}

test('closing short a fully paid order credits the supplier with the 2 missing units at their Toman price, once', async () => {
  const po = await paidShortOrder();
  // Paid 1,200,000; the 8 that came are worth 8 × 100,000 plus all 200,000 of the order's freight.
  assert.match((await closePurchaseOrderShort(po.id, 0)).error!, /تغییر کرده است/);
  const closed = await closePurchaseOrderShort(po.id, 200_000);
  assert.equal(closed.success, true, closed.error);
  assert.match(closed.message!, /۲۰۰٬۰۰۰ تومان پرداخت‌شده بابت کالای نرسیده به طلب از تأمین‌کننده اضافه شد/);
  const credits = await prisma.supplierCredit.findMany();
  assert.deepEqual(
    credits.map((c: any) => [Number(c.amount), c.purchaseOrderId, c.reason, c.clientRequestId]),
    [[200_000, po.id, `کسری سفارش خرید #${po.number}`, `po-short:${po.id}`]],
  );
  assert.equal((await closePurchaseOrderShort(po.id, 200_000)).success, false);
  assert.equal(await balance(), 200_000);
  // Usable on the next order like any credit.
  const next = await tenFrames();
  assert.equal((await payPurchaseOrderFromCredit({ orderId: next.id })).success, true);
  assert.equal(await balance(), 0);
  await assertPurchaseInvariants();
});

test('two closes at once credit once', async () => {
  const po = await paidShortOrder();
  const results = await Promise.all([closePurchaseOrderShort(po.id), closePurchaseOrderShort(po.id)]);
  assert.deepEqual(results.map((r) => r.success).sort(), [false, true]);
  assert.equal(await prisma.supplierCredit.count(), 1);
  assert.equal(await balance(), 200_000);
  await assertPurchaseInvariants();
});

test('closing short an order whose payments do not cover even what came creates no credit; the rest stays owed', async () => {
  // An order from before payments were required first: 500,000 paid, then moved on by hand.
  const po = await tenFrames();
  await recordPurchasePartialPayment({ orderId: po.id, accountId: 'toman', amount: 500_000 });
  await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: 'ARRIVED' } });
  await receivePurchaseOrderItems(po.id, w.main.id, [{ itemId: po.items[0].id, receivedQuantity: 8 }]);
  const closed = await closePurchaseOrderShort(po.id, 0);
  assert.equal(closed.success, true, closed.error);
  assert.doesNotMatch(closed.message!, /طلب/);
  assert.equal(await prisma.supplierCredit.count(), 0);
  // 1,000,000 of goods and freight came; 500,000 was paid; the order stays with its payments as they are.
  const payments = await prisma.purchaseOrderPayment.findMany({ where: { purchaseOrderId: po.id } });
  assert.deepEqual(payments.map((p: any) => Number(p.amount)), [500_000]);
  await assertPurchaseInvariants();
});

// --- where it shows ---

test('the order and supplier pages show the credit to finance viewers only; a credit payment reads as such', async () => {
  await cancelledWithCredit();
  const next = await tenFrames();
  await payPurchaseOrderFromCredit({ orderId: next.id, amount: 200_000 });
  const detail: any = (await getPurchaseOrder(next.id)).data;
  assert.equal(detail.supplierCreditBalance, 600_000);
  assert.deepEqual(detail.payments.map((p: any) => [p.amount, p.accountName, p.fromCredit, p.accountId]), [[200_000, 'طلب از تأمین‌کننده', true, undefined]]);
  const suppliers: any = await getSuppliers();
  assert.equal(suppliers.data.find((s: any) => s.id === w.supplier.id).creditBalance, 600_000);

  setTestRole('ACCOUNTANT');
  assert.equal(((await getPurchaseOrder(next.id)).data as any).supplierCreditBalance, 600_000);
  setTestRole('WAREHOUSE');
  assert.equal('supplierCreditBalance' in ((await getPurchaseOrder(next.id)).data as any), false);
  assert.ok(((await getSuppliers()) as any).data.every((s: any) => !('creditBalance' in s)));
});

// --- the table ---

test('the pre-push SQL creates SupplierCredit and frees PurchaseOrderPayment.accountId, and running it twice changes nothing', async () => {
  const sql = readFileSync(join(process.cwd(), 'prisma/sql/pre-push-unique-columns.sql'), 'utf8');
  // Back to the schema before this change.
  await prisma.$executeRawUnsafe('DROP TABLE "SupplierCredit"');
  await prisma.$executeRawUnsafe('ALTER TABLE "PurchaseOrderPayment" ALTER COLUMN "accountId" SET NOT NULL');
  await prisma.$executeRawUnsafe(sql);
  await prisma.$executeRawUnsafe(sql);

  const indexes = (await prisma.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'SupplierCredit' ORDER BY indexname`,
  )) as Array<{ indexname: string }>;
  assert.deepEqual(indexes.map((i) => i.indexname), [
    'SupplierCredit_clientRequestId_key',
    'SupplierCredit_pkey',
    'SupplierCredit_purchaseOrderId_idx',
    'SupplierCredit_supplierId_idx',
  ]);
  const keys = (await prisma.$queryRawUnsafe(
    `SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = '"SupplierCredit"'::regclass AND contype = 'f' ORDER BY conname`,
  )) as Array<{ conname: string; confdeltype: string }>;
  assert.deepEqual(keys.map((k) => [k.conname, k.confdeltype]), [['SupplierCredit_purchaseOrderId_fkey', 'r'], ['SupplierCredit_supplierId_fkey', 'r']]);
  const [column] = (await prisma.$queryRawUnsafe(
    `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'PurchaseOrderPayment' AND column_name = 'accountId'`,
  )) as Array<{ is_nullable: string }>;
  assert.equal(column.is_nullable, 'YES');

  // Exactly what Prisma expects: db push would find nothing left to do.
  const diff = spawnSync(
    join(process.cwd(), 'node_modules/.bin/prisma'),
    ['migrate', 'diff', '--from-url', process.env.DATABASE_URL!, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'],
    { encoding: 'utf8' },
  );
  assert.equal(diff.status, 0, diff.stdout + diff.stderr);
});
