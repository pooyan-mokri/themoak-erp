import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getPurchaseOrders } from '@/actions/supplier';
import { purchaseFigures, supplierBalances } from '@/components/suppliers/purchase-figures';
import { getDashboardFinancials } from '@/actions/dashboard';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const DAY = 86_400_000;

/**
 * Four orders from one supplier: 1,200,000 pending with 300,000 paid; 500,000 in production
 * (paid in full); a draft of 400,000; and one received 10 days after it was placed.
 */
async function seed() {
  const supplier = await prisma.supplier.create({ data: { name: 'Mazzucchelli' } });
  const product = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 0, sellPrice: 1 } });
  const bank = await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  const line = { productId: product.id, quantity: 2, unitCost: 1, unitCostInToman: 1 };
  const order = (status: string, total: number, paid: number, extra: Record<string, unknown> = {}) =>
    prisma.purchaseOrder.create({
      data: {
        supplierId: supplier.id,
        status,
        totalAmount: total,
        totalAmountInToman: total,
        items: { create: [{ ...line, ...extra }] },
        ...(paid > 0 && { payments: { create: [{ amount: paid, accountId: bank.id }] } }),
      },
    });
  await order('PARTIALLY_PAID', 1_200_000, 300_000);
  await order('IN_PRODUCTION', 500_000, 500_000);
  await order('DRAFT', 400_000, 0);
  const placed = new Date('2026-09-01T08:00:00Z');
  const received = await order('RECEIVED', 700_000, 700_000, { receivedQuantity: 2, receivedDate: new Date(placed.getTime() + 10 * DAY) });
  await prisma.purchaseOrder.update({ where: { id: received.id }, data: { createdAt: placed } });
  return { supplier };
}

test('the list carries what was paid for finance.view, and the figures follow from it', async () => {
  const { supplier } = await seed();
  setTestRole('ACCOUNTANT');
  const orders: any[] = (await getPurchaseOrders()).data;
  assert.deepEqual(orders.map((o) => o.paidAmountInToman).sort((a, b) => a - b), [0, 300_000, 500_000, 700_000]);

  const figures = purchaseFigures(orders);
  assert.equal(figures.open, 3, 'pending, in production and draft');
  assert.equal(figures.inTransit, 1);
  assert.equal(figures.payable, 900_000, 'only the pending order owes; a draft owes nothing yet');
  assert.equal(figures.suppliersOwed, 1);
  assert.equal(figures.leadTimeDays, 10);
  assert.deepEqual(supplierBalances(orders), { [supplier.id]: 900_000 });
});

test('without finance.view the list has no payments and the figures no money', async () => {
  await seed();
  setTestRole('WAREHOUSE');
  const orders: any[] = (await getPurchaseOrders()).data;
  assert.ok(orders.every((o) => o.paidAmountInToman === undefined && o.payments === undefined && o.totalAmount === undefined));
  const figures = purchaseFigures(orders);
  assert.equal(figures.payable, undefined);
  assert.equal(figures.open, 3);
  assert.equal(figures.leadTimeDays, 10);
});

test('an order closed short owes only for what came, as «مانده پرداخت به تأمین‌کنندگان» on the dashboard counts it', async () => {
  const supplier = await prisma.supplier.create({ data: { name: 'Mazzucchelli' } });
  const product = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 0, sellPrice: 1 } });
  const bank = await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  // 10 ordered at 100,000, 6 came, the order closed short; 200,000 paid: 400,000 still owed, not 800,000.
  await prisma.purchaseOrder.create({
    data: {
      supplierId: supplier.id,
      status: 'RECEIVED',
      totalAmount: 1_000_000,
      totalAmountInToman: 1_000_000,
      items: { create: [{ productId: product.id, quantity: 10, receivedQuantity: 6, unitCost: 100_000, unitCostInToman: 100_000 }] },
      payments: { create: [{ amount: 200_000, accountId: bank.id }] },
    },
  });
  setTestRole('ACCOUNTANT');
  const orders: any[] = (await getPurchaseOrders()).data;
  assert.equal(orders[0].unpaidInToman, 400_000);
  assert.equal(purchaseFigures(orders).payable, 400_000);
  assert.deepEqual(supplierBalances(orders), { [supplier.id]: 400_000 });
  assert.equal((await getDashboardFinancials()).totalPayables, 400_000);
  setTestRole('WAREHOUSE');
  assert.ok(((await getPurchaseOrders()).data as any[]).every((o) => o.unpaidInToman === undefined), 'no money without finance.view');
});
