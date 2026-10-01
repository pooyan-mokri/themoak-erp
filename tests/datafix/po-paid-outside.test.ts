import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getBalanceSheet } from '@/actions/reports';
import { latestRates, supplierPositions, unpaidOnPurchaseOrder, PURCHASE_ORDER_DEBT_FIELDS } from '@/lib/money-totals';
import { balances, reportRows, rowsHash, runTwice } from './sql';

// prisma/sql/datafix-2026-10-01-po-paid-outside.sql: orders #1 and #4 were paid outside the ERP.

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const DESCRIPTION = 'پرداخت‌شده بیرون از سیستم — ثبت اصلاحی';

/** A purchase order as the real data has it: Toman lines, some received, paid in part from the bank. */
async function purchaseOrder(number: number, supplierName: string, status: string, lines: Array<[number, number, number]>, paid: number) {
  const supplier = await prisma.supplier.create({ data: { name: supplierName } });
  const total = lines.reduce((sum, [quantity, unitCost]) => sum + quantity * unitCost, 0);
  const order = await prisma.purchaseOrder.create({
    data: { number, supplierId: supplier.id, status, totalAmount: total, totalAmountInToman: total },
  });
  for (const [i, [quantity, unitCost, received]] of lines.entries()) {
    const product = await prisma.product.create({ data: { name: `P${number}-${i}`, sku: `P${number}-${i}`, costPrice: unitCost, sellPrice: unitCost } });
    await prisma.purchaseOrderItem.create({
      data: { purchaseOrderId: order.id, productId: product.id, quantity, unitCost, unitCostInToman: unitCost, receivedQuantity: received },
    });
  }
  if (paid) {
    const payment = await prisma.transaction.create({
      data: { type: 'EXPENSE', amount: paid, amountInToman: paid, accountId: 'bank', category: 'Purchase Payment', description: `پرداخت سفارش خرید #${number}` },
    });
    await prisma.purchaseOrderPayment.create({ data: { purchaseOrderId: order.id, amount: paid, accountId: 'bank', transactionId: payment.id } });
  }
  return order;
}

const unpaid = async (id: string) =>
  unpaidOnPurchaseOrder(await prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, select: PURCHASE_ORDER_DEBT_FIELDS }) as any);

test('#1 and #4 get one account-less payment for what was unpaid; status, balances and other orders stay', async () => {
  await prisma.account.create({ data: { id: 'bank', name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 10_000_000 } });
  const po1 = await purchaseOrder(1, 'Mellume', 'RECEIVED', [[1, 339_060_280, 1]], 264_060_280);
  // #4: 2 of the 10 units of one line not received yet.
  const po4 = await purchaseOrder(4, 'FINEWELL', 'PARTIALLY_RECEIVED', [[10, 10_000_000, 8], [1, 39_022_000, 1]], 85_048_000);
  // Not named by Pooyan: left owing.
  const po2 = await purchaseOrder(2, 'Other', 'PARTIALLY_PAID', [[1, 30_000_000, 0]], 10_000_000);
  const otherPayments = await rowsHash('PurchaseOrderPayment');
  const accounts = await balances();
  const sheetBefore = await getBalanceSheet(new Date());
  assert.equal(sheetBefore.liabilities.accountsPayable, 75_000_000 + 33_974_000);
  assert.deepEqual((await reportRows('report-purchase-orders-paid-by-hand.sql')).map((r: any) => r.number), [1, 4]);

  await runTwice('datafix-2026-10-01-po-paid-outside.sql', ['PurchaseOrderPayment']);

  const recorded = await prisma.purchaseOrderPayment.findMany({ where: { description: DESCRIPTION }, orderBy: { amount: 'desc' } });
  assert.deepEqual(
    recorded.map((p: any) => [p.purchaseOrderId, Number(p.amount), p.accountId, p.transactionId]),
    [[po1.id, 75_000_000, null, null], [po4.id, 53_974_000, null, null]],
  );
  assert.equal(await rowsHash('PurchaseOrderPayment', recorded.map((p: any) => p.id)), otherPayments);
  assert.deepEqual([await unpaid(po1.id), await unpaid(po4.id), await unpaid(po2.id)], [0, 0, 20_000_000]);
  // Statuses come from receiving (#1, #4) and stay; #4 is not closed short.
  const statuses = await prisma.purchaseOrder.findMany({ orderBy: { number: 'asc' }, select: { number: true, status: true } });
  assert.deepEqual(statuses.map((o: any) => [o.number, o.status]), [[1, 'RECEIVED'], [2, 'PARTIALLY_PAID'], [4, 'PARTIALLY_RECEIVED']]);
  // No money moved.
  assert.deepEqual(await balances(), accounts);

  // Nothing is owed on them now; the 2 units of #4 still to come are paid for in advance.
  const sheet = await getBalanceSheet(new Date());
  assert.equal(sheet.liabilities.accountsPayable, 0);
  assert.equal(sheet.assets.prepaidPurchases, sheetBefore.assets.prepaidPurchases + 2 * 10_000_000);
  assert.equal((await supplierPositions(prisma, await latestRates(prisma))).unpaidOnOrders, 20_000_000);
  assert.deepEqual(await reportRows('report-purchase-orders-paid-by-hand.sql'), []);
});

test('an order still waiting for payment becomes PAID, as recording a payment makes it', async () => {
  await prisma.account.create({ data: { id: 'bank', name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 10_000_000 } });
  const po1 = await purchaseOrder(1, 'Mellume', 'PARTIALLY_PAID', [[1, 100_000_000, 0]], 40_000_000);
  const po4 = await purchaseOrder(4, 'FINEWELL', 'PENDING_PAYMENT', [[1, 50_000_000, 0]], 0);

  await runTwice('datafix-2026-10-01-po-paid-outside.sql', ['PurchaseOrderPayment', 'PurchaseOrder']);

  const after = await prisma.purchaseOrder.findMany({ orderBy: { number: 'asc' }, include: { payments: true } });
  assert.deepEqual(after.map((o: any) => [o.number, o.status, o.payments.reduce((s: number, p: any) => s + Number(p.amount), 0)]), [
    [1, 'PAID', 100_000_000],
    [4, 'PAID', 50_000_000],
  ]);
  assert.deepEqual([await unpaid(po1.id), await unpaid(po4.id)], [0, 0]);
});
