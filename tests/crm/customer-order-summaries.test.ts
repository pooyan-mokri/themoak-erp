import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { AccessDenied } from '@/lib/access';
import { getCustomerOrderSummaries } from '@/actions/customer';
import { returnOrderItem } from '@/actions/order-return';
import { cancelOrder } from '@/actions/sales';

// The actions log refusals on purpose.
console.error = () => {};

const PRICE = 1_000_000;

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/** Sara bought 2 × PRICE (discount 100,000, paid in full) and, in a second order, 1 × PRICE unpaid. */
async function seed({ second = true } = {}) {
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 1, sellPrice: PRICE } });
  await prisma.inventory.create({ data: { productId: frame.id, warehouseId: warehouse.id, quantity: 10 } });
  const till = await prisma.account.create({ data: { name: 'صندوق', type: 'CASH', currency: 'TOMAN', balance: 1_900_000 } });
  const sara = await prisma.customer.create({ data: { name: 'سارا', segment: 'VIP' } });
  const walkIn = await prisma.customer.create({ data: { name: 'رهگذر' } });
  const paid = await prisma.order.create({
    data: {
      customerId: sara.id,
      totalAmount: PRICE * 2,
      discount: 100_000,
      paidAmount: PRICE * 2 - 100_000,
      paymentStatus: 'PAID',
      items: { create: [{ productId: frame.id, quantity: 2, price: PRICE, warehouseId: warehouse.id }] },
    },
    include: { items: true },
  });
  const unpaid = !second ? null : await prisma.order.create({
    data: {
      customerId: sara.id,
      totalAmount: PRICE,
      paidAmount: 0,
      paymentStatus: 'UNPAID',
      items: { create: [{ productId: frame.id, quantity: 1, price: PRICE, warehouseId: warehouse.id }] },
    },
  });
  return { warehouse, till, sara, walkIn, paid, unpaid };
}

test('a customer is worth the orders not cancelled, net of discount, with a return taken off once', async () => {
  const { warehouse, till, sara, walkIn, paid, unpaid } = await seed();
  assert.deepEqual((await getCustomerOrderSummaries())[sara.id], { orders: 2, lifetimeValue: PRICE * 3 - 100_000 });

  // One frame of the paid order comes back: the order's total drops by its price, once, and the frame
  // takes its share of the discount (50,000 of the 100,000) with it.
  const back = await returnOrderItem(
    {},
    form({ orderId: paid.id, orderItemId: paid.items[0].id, quantity: '1', accountId: till.id, warehouseId: warehouse.id }),
  );
  assert.equal(back.success, true, back.message);
  assert.deepEqual((await getCustomerOrderSummaries())[sara.id], { orders: 2, lifetimeValue: PRICE * 2 - 50_000 });

  // A cancelled order counts neither as an order nor as value.
  const cancelled = await cancelOrder(unpaid!.id);
  assert.equal(cancelled.success, true, cancelled.message);
  assert.deepEqual((await getCustomerOrderSummaries())[sara.id], { orders: 1, lifetimeValue: PRICE - 50_000 });

  // A customer with no orders has no entry.
  assert.equal((await getCustomerOrderSummaries())[walkIn.id], undefined);
});

test('a fully returned order with a discount is worth nothing, not less than nothing', async () => {
  const { warehouse, till, sara, paid } = await seed({ second: false });
  const back = await returnOrderItem(
    {},
    form({ orderId: paid.id, orderItemId: paid.items[0].id, quantity: '2', accountId: till.id, warehouseId: warehouse.id }),
  );
  assert.equal(back.success, true, back.message);
  assert.deepEqual((await getCustomerOrderSummaries())[sara.id], { orders: 1, lifetimeValue: 0 });
});

test('the summaries need sales.view', async () => {
  await seed();
  for (const role of ['WAREHOUSE', 'PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    await assert.rejects(getCustomerOrderSummaries(), (error: unknown) => error instanceof AccessDenied, String(role));
  }
  for (const role of ['SALES', 'AUDITOR', 'ACCOUNTANT']) {
    setTestRole(role);
    assert.equal(Object.keys(await getCustomerOrderSummaries()).length, 1, role);
  }
});
