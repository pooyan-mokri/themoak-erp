import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { createInvoiceFromOrder } from '@/actions/invoice';
import type { SiteOrderData } from '@/lib/site-sale-data';

beforeEach(async () => {
  beforeQuery.fn = null;
  await resetDatabase();
});
after(() => prisma.$disconnect());

/**
 * A website order: 2 × 500,000 plus 100,000 freight, 50,000 off, 1,050,000 paid
 * into the gateway account. With `refunded`, the website refunded all of it and
 * cancelled the order, the way setSaleStatus leaves it.
 */
async function seedWebsiteOrder({ refunded }: { refunded: boolean }) {
  const customer = await prisma.customer.create({
    data: { name: 'مشتری سایت', phone: '09120000000', siteId: 'site-user-1', source: 'website' },
  });
  const warehouse = await prisma.warehouse.create({ data: { name: 'انبار سایت' } });
  const product = await prisma.product.create({
    data: { name: 'PANJ - Blue', sku: 'PANJ/BLUE', webId: 'MOAK-PANJ-BLUE', costPrice: 1000, sellPrice: 500000 },
  });
  await prisma.inventory.create({
    data: { productId: product.id, warehouseId: warehouse.id, quantity: refunded ? 5 : 3 },
  });
  const account = await prisma.account.create({
    data: { name: 'درگاه سایت', type: 'BANK', currency: 'TOMAN', balance: refunded ? 0 : 1050000 },
  });
  const income = await prisma.transaction.create({
    data: {
      type: 'INCOME',
      amount: 1050000,
      amountInToman: 1050000,
      currency: 'TOMAN',
      accountId: account.id,
      customerId: customer.id,
      category: 'Sales',
      description: 'فروش سایت SITE-2001',
    },
  });

  const siteData: SiteOrderData = {
    issuedAt: new Date().toISOString(),
    tag: 'website',
    customer: { name: 'مشتری سایت', mobile: '09120000000', email: null, siteId: 'site-user-1', ordersBefore: 0 },
    shipTo: { province: 'تهران', city: 'تهران', address: 'خیابان ولیعصر', postal: '1234567890', note: null },
    shipping: { zone: 'tehran', carrier: 'tipax', freight: 100000, free: false, trackingCode: null },
    payment: { gateway: 'zibal', trackId: 't-1', refNumber: 'ref-1', paidAt: null, amount: 1050000 },
    subtotal: 1000000,
    discount: 50000,
    coupon: 'OFF50',
    total: 1050000,
    unknownLines: [],
    history: [],
    review: [],
  };
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      status: refunded ? 'CANCELLED' : 'COMPLETED',
      siteReference: 'SITE-2001',
      siteData,
      totalAmount: refunded ? 50000 : 1100000,
      discount: 50000,
      paidAmount: refunded ? 0 : 1050000,
      transactionId: income.id,
      items: {
        create: [
          {
            productId: product.id,
            warehouseId: warehouse.id,
            quantity: 2,
            price: 500000,
            status: refunded ? 'CANCELLED' : 'PENDING',
          },
        ],
      },
    },
  });

  if (refunded) {
    const refund = await prisma.transaction.create({
      data: {
        type: 'EXPENSE',
        amount: 1050000,
        amountInToman: 1050000,
        currency: 'TOMAN',
        accountId: account.id,
        customerId: customer.id,
        category: 'Return',
        description: 'بازپرداخت سفارش سایت SITE-2001',
      },
    });
    await prisma.siteRefund.create({
      data: { orderId: order.id, refundId: 'r-1', transactionId: refund.id, amount: 1050000, at: new Date() },
    });
  }

  return order;
}

test('a cancelled website order is refused an invoice, and nothing is written', async () => {
  const order = await seedWebsiteOrder({ refunded: true });
  const before = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });

  const result = await createInvoiceFromOrder(order.id);

  assert.equal(result.success, false);
  assert.equal(result.message, 'برای سفارش لغوشده نمی‌توان فاکتور صادر کرد.');
  assert.equal(await prisma.invoice.count(), 0);
  assert.deepEqual(await prisma.order.findUniqueOrThrow({ where: { id: order.id } }), before);
});

test('a website cancel that lands while the invoice is being written wins, and no invoice is left', async () => {
  const order = await seedWebsiteOrder({ refunded: false });
  // setSaleStatus cancels the order after createInvoiceFromOrder has read it.
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Invoice' || params.action !== 'create') return;
    beforeQuery.fn = null;
    await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
  };

  const result = await createInvoiceFromOrder(order.id);

  assert.equal(result.success, false);
  assert.equal(result.message, 'برای سفارش لغوشده نمی‌توان فاکتور صادر کرد.');
  assert.equal(await prisma.invoice.count(), 0);
  const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(after.status, 'CANCELLED');
  assert.equal(after.invoiceId, null);
});

test('a completed website order is still invoiced, at what was paid', async () => {
  const order = await seedWebsiteOrder({ refunded: false });

  const result = await createInvoiceFromOrder(order.id);

  assert.equal(result.success, true, result.message);
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { orderId: order.id } });
  assert.equal(result.invoiceId, invoice.id);
  assert.equal(Number(invoice.subtotal), 1100000);
  assert.equal(Number(invoice.discount), 50000);
  assert.equal(Number(invoice.total), 1050000);
  assert.equal(Number(invoice.paidAmount), 1050000);
  assert.equal(invoice.status, 'PAID');
  const invoiced = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(invoiced.invoiceId, invoice.id);
});
