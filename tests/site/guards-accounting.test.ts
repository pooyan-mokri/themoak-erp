import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { deleteExpense, updateExpense } from '@/actions/accounting';
import type { SiteOrderData } from '@/lib/site-sale-data';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/**
 * A website order paid 1,000,000 into the gateway account, then refunded
 * 300,000 on the website: the refund is an EXPENSE linked from a SiteRefund.
 */
async function seedWebsiteRefund() {
  const customer = await prisma.customer.create({ data: { name: 'مشتری سایت', phone: '09120000000' } });
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const product = await prisma.product.create({
    data: { name: 'PANJ - Blue', sku: 'PANJ/BLUE', webId: 'MOAK-PANJ-BLUE', costPrice: 1000, sellPrice: 500000 },
  });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: 4 } });
  const account = await prisma.account.create({
    data: { name: 'درگاه سایت', type: 'BANK', currency: 'TOMAN', balance: 700000 },
  });
  const income = await prisma.transaction.create({
    data: {
      type: 'INCOME',
      amount: 1000000,
      amountInToman: 1000000,
      currency: 'TOMAN',
      accountId: account.id,
      category: 'Sales',
      description: 'سفارش سایت SITE-1001',
    },
  });

  const siteData: SiteOrderData = {
    issuedAt: new Date().toISOString(),
    tag: null,
    customer: { name: 'مشتری سایت', mobile: '09120000000', email: null, siteId: null, ordersBefore: 0 },
    shipTo: null,
    shipping: null,
    payment: { gateway: 'zibal', trackId: 't-1', refNumber: 'ref-1', paidAt: null, amount: 1000000 },
    subtotal: 1000000,
    discount: 0,
    coupon: null,
    total: 1000000,
    unknownLines: [],
    history: [],
    review: [],
  };
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      siteReference: 'SITE-1001',
      siteData,
      totalAmount: 700000,
      discount: 0,
      paidAmount: 700000,
      transactionId: income.id,
      items: { create: [{ productId: product.id, warehouseId: warehouse.id, quantity: 2, price: 500000 }] },
    },
  });

  const refund = await prisma.transaction.create({
    data: {
      type: 'EXPENSE',
      amount: 300000,
      amountInToman: 300000,
      currency: 'TOMAN',
      accountId: account.id,
      category: 'Return',
      description: 'بازپرداخت سفارش سایت SITE-1001',
    },
  });
  await prisma.siteRefund.create({
    data: { orderId: order.id, refundId: 'r-1', transactionId: refund.id, amount: 300000, at: new Date() },
  });

  return { account, order, refund };
}

async function balanceOf(accountId: string) {
  return Number((await prisma.account.findUniqueOrThrow({ where: { id: accountId } })).balance);
}

test('deleteExpense refuses a website refund and changes nothing', async () => {
  const { account, refund } = await seedWebsiteRefund();

  const result = await deleteExpense(refund.id);

  assert.equal(result.success, false);
  assert.match(String(result.message), /بازپرداخت سفارش سایت/);
  const after = await prisma.transaction.findUnique({ where: { id: refund.id }, include: { siteRefund: true } });
  assert.ok(after, 'the refund transaction must still exist');
  assert.equal(Number(after.amount), 300000);
  assert.equal(after.siteRefund?.refundId, 'r-1');
  assert.equal(await balanceOf(account.id), 700000);
});

test('updateExpense refuses a website refund and changes nothing', async () => {
  const { account, refund } = await seedWebsiteRefund();

  const result = await updateExpense({
    id: refund.id,
    amount: 50000,
    currency: 'TOMAN' as any,
    category: 'Other',
    description: 'edited',
    accountId: account.id,
  });

  assert.equal(result.success, false);
  assert.match(String(result.message), /بازپرداخت سفارش سایت/);
  const after = await prisma.transaction.findUniqueOrThrow({ where: { id: refund.id } });
  assert.equal(Number(after.amount), 300000);
  assert.equal(Number(after.amountInToman), 300000);
  assert.equal(after.category, 'Return');
  assert.equal(after.accountId, account.id);
  assert.equal(await balanceOf(account.id), 700000);
});

test('an ordinary expense on the same account can still be deleted', async () => {
  const { account, refund } = await seedWebsiteRefund();
  const expense = await prisma.transaction.create({
    data: {
      type: 'EXPENSE',
      amount: 200000,
      amountInToman: 200000,
      currency: 'TOMAN',
      accountId: account.id,
      category: 'اجاره',
      description: 'اجاره',
    },
  });
  await prisma.account.update({ where: { id: account.id }, data: { balance: { decrement: 200000 } } });

  const result = await deleteExpense(expense.id);

  assert.equal(result.success, true, String(result.message));
  assert.equal(await prisma.transaction.findUnique({ where: { id: expense.id } }), null);
  assert.equal(await balanceOf(account.id), 700000);
  assert.ok(await prisma.transaction.findUnique({ where: { id: refund.id } }));
});
