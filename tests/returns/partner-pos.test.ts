import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { createOrder, recordOrderPayment } from '@/actions/sales';
import { paySettlement } from '@/actions/consignment';
import { returnOrderItem } from '@/actions/order-return';
import { NOT_CONSIGNMENT_MESSAGE } from '@/lib/consignment-amounts';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const PRICE = 1_000_000;

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/** A partner on 10% commission, bought from at the shop's POS (a physical warehouse). */
async function shop() {
  const partner = await prisma.customer.create({ data: { name: 'همکار', commissionRate: 10 } });
  await prisma.warehouse.create({ data: { name: 'انبار امانی - همکار', isVirtual: true, customerId: partner.id } });
  const store = await prisma.warehouse.create({ data: { name: 'فروشگاه' } });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 300_000, sellPrice: PRICE } });
  await prisma.inventory.create({ data: { productId: frame.id, warehouseId: store.id, quantity: 5 } });
  const bank = await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  return { partner, store, frame, bank };
}
type Shop = Awaited<ReturnType<typeof shop>>;

async function sell(s: Shop, quantity: number, paid: number) {
  const result = await createOrder({
    customerId: s.partner.id,
    items: [{ productId: s.frame.id, quantity, price: PRICE }],
    paymentMethod: 'CASH',
    accountId: paid > 0 ? s.bank.id : '',
    totalAmount: PRICE * quantity,
    paidAmount: paid,
    warehouseId: s.store.id,
  });
  assert.equal(result.success, true, result.message);
  return prisma.order.findFirstOrThrow({ include: { items: true } });
}

async function returnOne(s: Shop, orderId: string, orderItemId: string) {
  const result = await returnOrderItem({}, form({ orderId, orderItemId, quantity: '1', accountId: s.bank.id, warehouseId: s.store.id }));
  assert.equal(result.success, true, result.message);
}

const balance = async (id: string) => Number((await prisma.account.findUniqueOrThrow({ where: { id } })).balance);

test('a POS sale to a partner is stored gross: a full return refunds the full price', async () => {
  const s = await shop();
  const order = await sell(s, 1, PRICE);
  assert.equal(await balance(s.bank.id), PRICE);

  await returnOne(s, order.id, order.items[0].id);

  assert.equal(await balance(s.bank.id), 0, 'the customer got back what they paid');
  const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(Number(after.paidAmount), 0);
});

test('a POS sale to a partner is paid in full through «ثبت پرداخت», never settled at a net', async () => {
  const s = await shop();
  const order = await sell(s, 2, 0);
  assert.deepEqual(await prisma.consignmentCommission.findMany({ where: { orderId: order.id } }), []);

  // Not a consignment invoice: the settlement modal refuses it, and nothing moves.
  const refused = await paySettlement(undefined, form({ orderId: order.id, accountId: s.bank.id, amount: '1800000' }));
  assert.equal(refused.message, NOT_CONSIGNMENT_MESSAGE);
  assert.equal(await balance(s.bank.id), 0);

  // The partner owes the full 2,000,000, like any customer.
  assert.equal((await recordOrderPayment(order.id, s.bank.id, 2_000_000)).success, true);
  const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.deepEqual([Number(paid.totalAmount), Number(paid.paidAmount), paid.paymentStatus], [2_000_000, 2_000_000, 'PAID']);

  // A frame comes back: its full price is refunded.
  await returnOne(s, order.id, order.items[0].id);
  assert.equal(await balance(s.bank.id), 1_000_000);
});
