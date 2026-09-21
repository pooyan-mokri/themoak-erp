import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { cancelOrder, createOrder, getOrder, getOrders, recordOrderPayment } from '@/actions/sales';
import { getSalesAnalytics } from '@/actions/sales-analytics';
import { getOrderReturns, returnOrderItem } from '@/actions/order-return';
import { exchangeOrderItem, getOrderExchanges } from '@/actions/order-exchange';
import { createInvoiceFromOrder, getARAgingReport, getInvoiceById, getInvoices } from '@/actions/invoice';
import {
  createCustomer,
  deleteCustomer,
  getCustomer,
  getCustomerById,
  getCustomers,
  getCustomersWithDebt,
  updateCustomerCredit,
} from '@/actions/customer';
import { createPromotion, deletePromotion, getPromotions } from '@/actions/promotion';

const DENIED = 'شما به این بخش دسترسی ندارید.';
const COST = 4_000_000;
const PRICE = 15_700_000;
const BALANCE = 987_654_321;

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(async () => {
  setTestRole('ADMIN');
  await prisma.$disconnect();
});

/** A part-paid POS order of 4 × PRICE, with an invoice, a return and an exchange on it. */
async function seed() {
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const product = await prisma.product.create({ data: { name: 'PANJ - Blue', sku: 'PANJ/BLUE', costPrice: COST, sellPrice: PRICE } });
  const other = await prisma.product.create({ data: { name: 'YEK - Black', sku: 'YEK/BLK', costPrice: COST, sellPrice: PRICE } });
  await prisma.inventory.createMany({
    data: [
      { productId: product.id, warehouseId: warehouse.id, quantity: 10 },
      { productId: other.id, warehouseId: warehouse.id, quantity: 10 },
    ],
  });
  const account = await prisma.account.create({ data: { name: 'صندوق', type: 'CASH', currency: 'TOMAN', balance: BALANCE } });
  const customer = await prisma.customer.create({ data: { name: 'سارا', creditLimit: 5_000_000 } });
  const income = await prisma.transaction.create({
    data: { type: 'INCOME', amount: PRICE, amountInToman: PRICE, accountId: account.id, customerId: customer.id, category: 'Sales' },
  });
  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      totalAmount: PRICE * 4,
      paidAmount: PRICE,
      paymentStatus: 'PARTIAL',
      status: 'COMPLETED',
      transactionId: income.id,
      items: { create: [{ productId: product.id, quantity: 4, price: PRICE, warehouseId: warehouse.id }] },
    },
    include: { items: true },
  });
  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: 'INV-T-1',
      orderId: order.id,
      customerId: customer.id,
      dueDate: new Date('2030-01-01'),
      subtotal: PRICE * 4,
      total: PRICE * 4,
      paidAmount: PRICE,
      status: 'PARTIAL',
    },
  });
  const exchangeItem = await prisma.orderItem.create({
    data: { orderId: order.id, productId: other.id, quantity: 1, price: PRICE, warehouseId: warehouse.id },
  });
  await prisma.orderReturn.create({
    data: { orderId: order.id, orderItemId: order.items[0].id, quantity: 1, refundAmount: 0, accountId: account.id },
  });
  await prisma.orderExchange.create({
    data: { orderId: order.id, originalItemId: order.items[0].id, exchangeItemId: exchangeItem.id, quantity: 1, priceDifference: 0, accountId: account.id },
  });
  return { warehouse, product, other, account, customer, order, item: order.items[0], invoice };
}

/** Every object inside a value, however deep. */
function* objects(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) for (const entry of value) yield* objects(entry);
  else if (value && typeof value === 'object' && !(value instanceof Date)) {
    yield value as Record<string, unknown>;
    for (const entry of Object.values(value)) yield* objects(entry);
  }
}
const hasKey = (value: unknown, key: string) => [...objects(value)].some((o) => key in o);

/** What each sales read returns for the signed-in role. */
async function salesReads(ids: Awaited<ReturnType<typeof seed>>) {
  return {
    orders: await getOrders(),
    order: await getOrder(ids.order.id),
    returns: await getOrderReturns(ids.order.id),
    exchanges: await getOrderExchanges(ids.order.id),
    invoice: await getInvoiceById(ids.invoice.id),
    customer: await getCustomer(ids.customer.id),
    customerById: await getCustomerById(ids.customer.id),
  };
}

test('sales reads strip product cost without cost.view and account balances without finance.view, however nested', async () => {
  const ids = await seed();
  const expect: Record<string, { cost: boolean; balance: boolean }> = {
    ADMIN: { cost: true, balance: true },
    AUDITOR: { cost: true, balance: true },
    ACCOUNTANT: { cost: false, balance: true },
    SALES: { cost: false, balance: false },
  };
  for (const [role, sees] of Object.entries(expect)) {
    setTestRole(role);
    const reads = await salesReads(ids);
    for (const [name, value] of Object.entries(reads)) {
      assert.ok(value, `${role} ${name}`);
      assert.equal(hasKey(value, 'costPrice'), sees.cost, `${role} ${name} costPrice`);
      assert.equal(hasKey(value, 'balance'), sees.balance && name !== 'orders' && name !== 'customer', `${role} ${name} balance`);
      assert.equal(JSON.stringify(value).includes(String(BALANCE)), sees.balance && name !== 'orders' && name !== 'customer', `${role} ${name} balance value`);
    }
    // Sell prices and order amounts stay for every sales viewer.
    assert.equal(reads.order?.items[0].product?.sellPrice, PRICE, role);
    assert.equal(reads.order?.totalAmount, PRICE * 4, role);
    assert.equal(reads.customerById?.stats.totalDebt, PRICE * 3, role);
    if (sees.cost) assert.equal((reads.order?.items[0].product as any).costPrice, COST, role);
  }

  for (const role of ['WAREHOUSE', 'USER', null]) {
    setTestRole(role);
    for (const read of [
      () => getOrders(),
      () => getOrder(ids.order.id),
      () => getOrderReturns(ids.order.id),
      () => getOrderExchanges(ids.order.id),
      () => getInvoices(),
      () => getInvoiceById(ids.invoice.id),
      () => getCustomers(),
      () => getCustomersWithDebt(),
      () => getCustomerById(ids.customer.id),
      () => getPromotions(),
    ]) {
      await assert.rejects(read(), { message: DENIED }, String(role));
    }
  }
});

test('revenue analytics and AR aging need finance.view', async () => {
  await seed();
  for (const role of ['SALES', 'WAREHOUSE']) {
    setTestRole(role);
    await assert.rejects(getSalesAnalytics(), { message: DENIED }, role);
    await assert.rejects(getARAgingReport(), { message: DENIED }, role);
  }
  for (const role of ['ACCOUNTANT', 'AUDITOR', 'ADMIN']) {
    setTestRole(role);
    assert.equal((await getSalesAnalytics()).summary.totalOrders, 1, role);
    assert.equal((await getARAgingReport()).length, 1, role);
  }
});

/** Everything a sales write could touch. */
async function snapshot() {
  const rows = async (model: any) =>
    JSON.stringify(await model.findMany({ orderBy: { id: 'asc' } }), (_k, v) => (typeof v === 'bigint' ? String(v) : v));
  return {
    orders: await rows(prisma.order),
    items: await rows(prisma.orderItem),
    invoices: await rows(prisma.invoice),
    inventory: JSON.stringify(await prisma.inventory.findMany({ orderBy: [{ productId: 'asc' }, { warehouseId: 'asc' }] })),
    accounts: await rows(prisma.account),
    transactions: await rows(prisma.transaction),
    returns: await rows(prisma.orderReturn),
    exchanges: await rows(prisma.orderExchange),
    customers: await rows(prisma.customer),
    promotions: await rows(prisma.promotion),
  };
}

test('sales writes refuse AUDITOR and WAREHOUSE and write nothing', async () => {
  const ids = await seed();
  const promotion = await prisma.promotion.create({
    data: { name: 'Yalda', type: 'DISCOUNT', startDate: new Date('2026-01-01'), endDate: new Date('2027-01-01') },
  });
  const before = await snapshot();

  for (const role of ['AUDITOR', 'WAREHOUSE', 'USER']) {
    setTestRole(role);
    const created = await createOrder({
      customerId: ids.customer.id,
      items: [{ productId: ids.product.id, quantity: 1, price: PRICE }],
      paymentMethod: 'CASH',
      accountId: ids.account.id,
      totalAmount: PRICE,
      warehouseId: ids.warehouse.id,
    });
    assert.equal(created.message, DENIED, role);
    assert.equal((await recordOrderPayment(ids.order.id, ids.account.id, 1000)).message, DENIED, role);
    assert.equal((await cancelOrder(ids.order.id)).message, DENIED, role);
    const returned = await returnOrderItem(
      {},
      form({ orderId: ids.order.id, orderItemId: ids.item.id, quantity: '1', accountId: ids.account.id, warehouseId: ids.warehouse.id }),
    );
    assert.deepEqual(returned, { message: DENIED, success: false }, role);
    const exchanged = await exchangeOrderItem(
      {},
      form({
        orderId: ids.order.id,
        originalItemId: ids.item.id,
        exchangeProductId: ids.other.id,
        quantity: '1',
        accountId: ids.account.id,
        returnWarehouseId: ids.warehouse.id,
        exchangeWarehouseId: ids.warehouse.id,
      }),
    );
    assert.deepEqual(exchanged, { message: DENIED, success: false }, role);
    assert.equal((await createInvoiceFromOrder(ids.order.id)).message, DENIED, role);
    assert.deepEqual(await createCustomer({}, form({ name: 'نو' })), { message: DENIED }, role);
    assert.equal((await deleteCustomer(ids.customer.id)).message, DENIED, role);
    assert.equal((await updateCustomerCredit(ids.customer.id, 1, 1)).message, DENIED, role);
    assert.deepEqual(
      await createPromotion({}, form({ name: 'X', type: 'DISCOUNT', startDate: '2026-01-01', endDate: '2027-01-01' })),
      { message: DENIED },
      role,
    );
    assert.equal((await deletePromotion(promotion.id)).message, DENIED, role);
  }

  assert.deepEqual(await snapshot(), before);
});

test('SALES can still sell, take a payment, return, exchange, invoice, cancel and manage customers', async () => {
  const ids = await seed();
  await prisma.invoice.delete({ where: { id: ids.invoice.id } });
  setTestRole('SALES');

  const created = await createOrder({
    customerId: ids.customer.id,
    items: [{ productId: ids.product.id, quantity: 1, price: PRICE }],
    paymentMethod: 'CASH',
    accountId: ids.account.id,
    totalAmount: PRICE,
    paidAmount: 0,
    warehouseId: ids.warehouse.id,
  });
  assert.equal(created.success, true, created.message);
  const sale = await prisma.order.findFirstOrThrow({ where: { id: { not: ids.order.id } }, include: { items: true } });

  assert.equal((await recordOrderPayment(sale.id, ids.account.id, 1_000_000)).success, true);
  assert.equal(Number((await prisma.order.findUniqueOrThrow({ where: { id: sale.id } })).paidAmount), 1_000_000);

  const returned = await returnOrderItem(
    {},
    form({ orderId: ids.order.id, orderItemId: ids.item.id, quantity: '1', accountId: ids.account.id, warehouseId: ids.warehouse.id }),
  );
  assert.equal(returned.success, true, returned.message);

  const exchanged = await exchangeOrderItem(
    {},
    form({
      orderId: ids.order.id,
      originalItemId: ids.item.id,
      exchangeProductId: ids.other.id,
      quantity: '1',
      accountId: ids.account.id,
      returnWarehouseId: ids.warehouse.id,
      exchangeWarehouseId: ids.warehouse.id,
    }),
  );
  assert.equal(exchanged.success, true, exchanged.message);

  const invoiced = await createInvoiceFromOrder(sale.id);
  assert.equal(invoiced.success, true, invoiced.message);

  // This order has a payment recorded after the sale, a return and an exchange: its cancel is refused.
  const refused = await cancelOrder(sale.id);
  assert.equal(refused.success, false);

  // A sale paid only at checkout: SALES may cancel it, which reverses that payment.
  const paidAtCheckout = await createOrder({
    customerId: ids.customer.id,
    items: [{ productId: ids.product.id, quantity: 1, price: PRICE }],
    paymentMethod: 'CASH',
    accountId: ids.account.id,
    totalAmount: PRICE,
    paidAmount: PRICE,
    warehouseId: ids.warehouse.id,
  });
  assert.equal(paidAtCheckout.success, true, paidAtCheckout.message);
  const second = await prisma.order.findFirstOrThrow({ where: { id: { notIn: [ids.order.id, sale.id] } } });
  const cancelled = await cancelOrder(second.id);
  assert.equal(cancelled.success, true, cancelled.message);

  const customer = await createCustomer({}, form({ name: 'مشتری تازه' }));
  assert.equal(customer.success, true, customer.message);
  assert.equal((await updateCustomerCredit(ids.customer.id, 9_000_000, 45)).success, true);

  const promotion = await createPromotion({}, form({ name: 'Nowruz', type: 'DISCOUNT', description: '', startDate: '2026-03-01', endDate: '2026-04-01' }));
  assert.equal(promotion.success, true, promotion.message);
});
