import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { POST } from '@/app/api/erp/route';

// The website's sale path runs from /api/erp with a bearer key and no session. The auth stub
// defaults to ADMIN, so these run with no signed-in user at all: a permission check on the
// way (the invoice sync, say) would refuse them here.

const TOKEN = 'sales-products-site-sale-token';

beforeEach(async () => {
  process.env.ERP_API_SECRET = TOKEN;
  setTestRole(null);
  await resetDatabase();
});
after(async () => {
  setTestRole('ADMIN');
  await prisma.$disconnect();
});

async function call(action: string, body: Record<string, unknown>) {
  const res = await POST(
    new NextRequest('http://localhost/api/erp', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    }),
  );
  return { status: res.status, body: await res.json() };
}

test('with no signed-in user, createSale records a website sale and setSaleStatus keeps its invoice in step', async () => {
  await prisma.account.create({ data: { name: 'بانک سامان', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const product = await prisma.product.create({
    data: { name: 'DAMN RAW - White', sku: 'RAW/WHIT', webId: 'MOAK-DAMN-RAW-WHITE', costPrice: 1, sellPrice: 18_500_000 },
  });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: 3 } });

  const sold = await call('createSale', {
    reference: 'M-NOSESSION',
    issuedAt: '2026-09-10T18:42:11.000Z',
    tag: 'website',
    warehouseId: warehouse.id,
    customer: { name: 'سارا', mobile: '09123456789', email: null, siteId: 'site-user-1', ordersBefore: 0 },
    shipTo: { province: 'تهران', city: 'تهران', address: 'خیابان ولیعصر', postal: '1234567890', note: null },
    shipping: { zone: 'tehran', carrier: 'تیپاکس', freight: 0, free: true, trackingCode: null },
    items: [
      {
        webId: 'MOAK-DAMN-RAW-WHITE',
        erpId: 'MOAK-DAMN-RAW-WHITE',
        sku: null,
        productId: 'site-product-1',
        name: 'DAMN RAW - White',
        quantity: 1,
        unitPrice: 18_500_000,
        lineTotal: 18_500_000,
      },
    ],
    subtotal: 18_500_000,
    discount: 0,
    coupon: null,
    total: 18_500_000,
    currency: 'toman',
    payment: { gateway: 'zibal', trackId: 'T1', refNumber: 'R1', paidAt: '2026-09-10T18:41:55.000Z', amount: 18_500_000 },
  });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));

  const order = await prisma.order.findUniqueOrThrow({ where: { siteReference: 'M-NOSESSION' } });
  assert.equal(Number(order.paidAmount), 18_500_000);
  assert.equal(
    (await prisma.inventory.findUniqueOrThrow({
      where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
    })).quantity,
    2,
  );

  await prisma.invoice.create({
    data: {
      invoiceNumber: 'INV-NOSESSION-1',
      orderId: order.id,
      customerId: order.customerId as string,
      dueDate: new Date('2030-01-01T00:00:00.000Z'),
      subtotal: 18_500_000,
      total: 18_500_000,
      paidAmount: 18_500_000,
      status: 'PAID',
    },
  });

  const refunded = await call('setSaleStatus', { status: 'refunded', reference: 'M-NOSESSION', amount: 500_000, refundId: 'r1' });
  assert.equal(refunded.status, 200, JSON.stringify(refunded.body));
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { orderId: order.id } });
  assert.deepEqual(
    [Number(invoice.subtotal), Number(invoice.total), Number(invoice.paidAmount), invoice.status],
    [18_000_000, 18_000_000, 18_000_000, 'PAID'],
  );
});
