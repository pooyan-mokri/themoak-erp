import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { cancelOrder, createOrder } from '@/actions/sales';
import { calculateCustomerDebt, getCustomerById, getCustomerStats, getCustomersWithDebt } from '@/actions/customer';
import { getCRMDashboardStats } from '@/actions/crm';
import { returnOrderItem } from '@/actions/order-return';
import { openAccount, stockIn } from '../sales/world';

/**
 * What a customer owes and has bought, as src/actions/customer.ts computes it.
 * customer.ts is being rewritten in another branch, so the cases it still gets
 * wrong are recorded as TODO here (they run, and report, without failing the
 * suite) instead of being fixed in this branch.
 */

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const PRICE = 10_000_000;

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/** سارا: one credit sale of 10,000,000 (1,000,000 off) still owed, and one of 20,000,000 cancelled. */
async function sara() {
  const store = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 1, sellPrice: PRICE } });
  await stockIn(frame.id, store.id, 10);
  await openAccount('بانک');
  const customer = await prisma.customer.create({ data: { name: 'سارا' } });
  const sell = async (quantity: number, discount: number) => {
    const result = await createOrder({
      customerId: customer.id,
      items: [{ productId: frame.id, quantity, price: PRICE }],
      paymentMethod: 'CASH',
      accountId: '',
      totalAmount: PRICE * quantity,
      discount,
      paidAmount: 0,
      warehouseId: store.id,
    });
    assert.equal(result.success, true, result.message);
    return prisma.order.findFirstOrThrow({ orderBy: { number: 'desc' } });
  };
  await sell(1, 1_000_000);
  const cancelled = await sell(2, 0);
  assert.equal((await cancelOrder(cancelled.id)).success, true);
  return customer;
}

test('the CRM ranking counts only the sale that stands, after its discount', async () => {
  const customer = await sara();
  const [top] = (await getCRMDashboardStats()).topCustomers as any[];
  assert.deepEqual([top.id, top.totalRevenue], [customer.id, 9_000_000]);
});

test('an order returned in full after a discount is worth nothing to the ranking, not less than nothing', async () => {
  const store = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 1, sellPrice: PRICE } });
  await stockIn(frame.id, store.id, 10);
  const bank = await openAccount('بانک');
  const customer = await prisma.customer.create({ data: { name: 'مینا' } });
  const sell = async (discount: number, paid: number) => {
    const result = await createOrder({
      customerId: customer.id,
      items: [{ productId: frame.id, quantity: 1, price: PRICE }],
      paymentMethod: 'CASH',
      accountId: paid ? bank.id : '',
      totalAmount: PRICE,
      discount,
      paidAmount: paid,
      warehouseId: store.id,
    });
    assert.equal(result.success, true, result.message);
    return prisma.order.findFirstOrThrow({ orderBy: { number: 'desc' }, include: { items: true } });
  };
  const returned = await sell(2_000_000, 8_000_000);
  const back = await returnOrderItem({}, form({ orderId: returned.id, orderItemId: returned.items[0].id, quantity: '1', accountId: bank.id, warehouseId: store.id }));
  assert.equal(back.success, true, back.message);
  // The return left the order at 0 with its 2,000,000 discount still on it.
  const after = await prisma.order.findUniqueOrThrow({ where: { id: returned.id } });
  assert.deepEqual([Number(after.totalAmount), Number(after.discount)], [0, 2_000_000]);
  await sell(0, 0);

  const [top] = (await getCRMDashboardStats()).topCustomers as any[];
  assert.deepEqual([top.name, top.totalRevenue], ['مینا', PRICE]);
});

test('a customer\'s debt leaves a cancelled order out, on every screen that shows it', { todo: 'customer.ts (hands off): a cancelled order keeps its total and is UNPAID, so it is counted as owed' }, async () => {
  const customer = await sara();
  assert.equal(await calculateCustomerDebt(customer.id), 9_000_000);
  assert.equal((await getCustomerStats(customer.id))!.totalDebt, 9_000_000);
  assert.equal((await getCustomerById(customer.id))!.stats.totalDebt, 9_000_000);
  assert.equal((await getCustomersWithDebt()).find((c: any) => c.id === customer.id)!.totalDebt, 9_000_000);
});

test('a customer\'s order count and average leave a cancelled order out', { todo: 'customer.ts (hands off): totalOrders and averageOrderValue count cancelled orders' }, async () => {
  const customer = await sara();
  const stats = (await getCustomerStats(customer.id))!;
  assert.deepEqual([stats.totalOrders, (await getCustomerById(customer.id))!.stats.totalOrders], [1, 1]);
});
