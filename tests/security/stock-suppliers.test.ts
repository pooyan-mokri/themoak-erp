import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import {
  createPurchaseOrder,
  createSupplier,
  getPurchaseOrder,
  getPurchaseOrders,
  getSuppliers,
  receivePurchaseOrder,
  receivePurchaseOrderItems,
} from '@/actions/supplier';
import {
  recordArrival,
  recordPurchasePartialPayment,
  recordPurchasePayment,
  updatePurchaseOrderStatus,
} from '@/actions/supplier-workflow';
import { DENIED, exposed } from './stock-helpers';

const UNIT_COST_KEYS = ['unitCost', 'unitCostInToman', 'totalCostInToman', 'additionalCost', 'additionalCostInToman', 'costPrice', 'sellPrice'];
const FINANCE_KEYS = ['totalAmount', 'totalAmountInToman', 'payments', 'paidAmountInToman', 'paymentTransaction', 'transaction', 'transactionId', 'paymentAccountId', 'arrivalAccountId'];
const EXTRA_COST_KEYS = ['amount', 'amountInToman'];
const BALANCE = 10_000_000;

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/**
 * An ARRIVED order: 10 frames at 100,000 plus 200,000 freight, so the landed cost is 120,000 each.
 * Paid 300,000 of 1,200,000; one arrival cost paid from the bank.
 */
async function seed() {
  const supplier = await prisma.supplier.create({ data: { name: 'Mazzucchelli', phone: '+39 02 000', email: 'sales@mazz.test' } });
  const product = await prisma.product.create({ data: { name: 'PANJ - Blue', sku: 'PANJ/BLUE', costPrice: 0, sellPrice: 2_000_000 } });
  const warehouse = await prisma.warehouse.create({ data: { name: 'مرکزی' } });
  const account = await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: BALANCE } });
  const payment = await prisma.transaction.create({
    data: { type: 'EXPENSE', amount: 300_000, amountInToman: 300_000, accountId: account.id, category: 'Purchase Payment' },
  });
  const arrival = await prisma.transaction.create({
    data: { type: 'EXPENSE', amount: 50_000, amountInToman: 50_000, accountId: account.id, category: 'Purchase Arrival Cost' },
  });
  const order = await prisma.purchaseOrder.create({
    data: {
      supplierId: supplier.id,
      status: 'ARRIVED',
      totalAmount: 1_200_000,
      totalAmountInToman: 1_200_000,
      paymentAccountId: account.id,
      arrivalAccountId: account.id,
      paymentTransactionId: payment.id,
      items: { create: [{ productId: product.id, quantity: 10, unitCost: 100_000, unitCostInToman: 100_000, exchangeRateSnapshot: 1 }] },
      additionalCosts: { create: [{ title: 'حمل', amount: 150_000, amountInToman: 150_000 }] },
      arrivalAdditionalCosts: { create: [{ title: 'ترخیص', amount: 50_000, amountInToman: 50_000, transactionId: arrival.id }] },
      payments: { create: [{ amount: 300_000, accountId: account.id, transactionId: payment.id }] },
    },
    include: { items: true },
  });
  const order2 = (status: string) =>
    prisma.purchaseOrder.create({
      data: {
        supplierId: supplier.id,
        status,
        totalAmount: 500_000,
        totalAmountInToman: 500_000,
        items: { create: [{ productId: product.id, quantity: 5, unitCost: 100_000, unitCostInToman: 100_000 }] },
      },
    });
  return { supplier, product, warehouse, account, order, order2 };
}

test('WAREHOUSE sees suppliers, items, quantities and status, but no price, cost, total or payment', async () => {
  const s = await seed();
  setTestRole('WAREHOUSE');

  const one = await getPurchaseOrder(s.order.id);
  assert.equal(one.success, true);
  const order: any = one.data;
  assert.deepEqual(exposed(order, [...UNIT_COST_KEYS, ...FINANCE_KEYS, ...EXTRA_COST_KEYS]), []);
  assert.deepEqual(
    [order.status, order.supplier.phone, order.items[0].quantity, order.items[0].product.name, order.additionalCosts[0].title],
    ['ARRIVED', '+39 02 000', 10, 'PANJ - Blue', 'حمل'],
  );

  const list: any = await getPurchaseOrders();
  assert.equal(list.data.length, 1);
  assert.deepEqual(exposed(list.data, [...UNIT_COST_KEYS, ...FINANCE_KEYS, ...EXTRA_COST_KEYS]), []);

  const suppliers: any = await getSuppliers();
  assert.equal(suppliers.data[0].email, 'sales@mazz.test');
});

test('ACCOUNTANT sees totals, payments and additional costs but no unit price or landed cost; AUDITOR sees all', async () => {
  const s = await seed();

  setTestRole('ACCOUNTANT');
  const order: any = (await getPurchaseOrder(s.order.id)).data;
  assert.deepEqual(exposed(order, UNIT_COST_KEYS), []);
  assert.deepEqual(
    [order.totalAmountInToman, order.paidAmountInToman, order.payments.length, order.additionalCosts[0].amount, order.arrivalAdditionalCosts[0].amountInToman],
    [1_200_000, 300_000, 1, 150_000, 50_000],
  );
  assert.equal(order.arrivalAdditionalCosts[0].transaction.id, order.arrivalAdditionalCosts[0].transactionId);
  assert.deepEqual(exposed((await getPurchaseOrders()).data, UNIT_COST_KEYS), []);

  setTestRole('AUDITOR');
  const full: any = (await getPurchaseOrder(s.order.id)).data;
  assert.deepEqual([full.items[0].unitCost, full.items[0].unitCostInToman, full.totalAmountInToman], [100_000, 100_000, 1_200_000]);
  assert.equal(full.payments.length, 1);

  setTestRole('SALES');
  assert.deepEqual(exposed((await getPurchaseOrder(s.order.id)).data, [...UNIT_COST_KEYS, ...FINANCE_KEYS, ...EXTRA_COST_KEYS]), []);

  for (const role of ['PROJECT_MANAGER', 'USER', null]) {
    setTestRole(role);
    assert.deepEqual(await getPurchaseOrder(s.order.id), { success: false, error: DENIED }, String(role));
    assert.deepEqual(await getPurchaseOrders(), { success: false, error: DENIED }, String(role));
    assert.deepEqual(await getSuppliers(), { success: false, error: DENIED }, String(role));
  }
});

test('only cost.edit creates a purchase order; suppliers take stock.manage or finance.manage', async () => {
  const s = await seed();
  const input = {
    supplierId: s.supplier.id,
    items: [{ productId: s.product.id, quantity: 2, unitCost: 1000, currency: 'TOMAN' as const }],
    additionalCosts: [{ title: 'حمل', amount: 100, currency: 'TOMAN' as const }],
  };

  for (const role of ['WAREHOUSE', 'ACCOUNTANT', 'AUDITOR', 'SALES']) {
    setTestRole(role);
    assert.equal((await createPurchaseOrder(input)).error, DENIED, role);
  }
  assert.equal(await prisma.purchaseOrder.count(), 1);
  setTestRole('ADMIN');
  assert.equal((await createPurchaseOrder(input)).success, true);
  assert.equal(await prisma.purchaseOrder.count(), 2);

  for (const role of ['AUDITOR', 'SALES']) {
    setTestRole(role);
    assert.equal((await createSupplier(undefined, form({ name: `رد ${role}` }))).error, DENIED, role);
  }
  assert.equal(await prisma.supplier.count(), 1);
  for (const role of ['WAREHOUSE', 'ACCOUNTANT']) {
    setTestRole(role);
    assert.equal((await createSupplier(undefined, form({ name: `تامین ${role}` }))).success, true, role);
  }
  assert.equal(await prisma.supplier.count(), 3);
});

test('receiving takes stock.manage, and the movement note carries no landed cost', async () => {
  const s = await seed();
  const receive = () => receivePurchaseOrderItems(s.order.id, s.warehouse.id, [{ itemId: s.order.items[0].id, receivedQuantity: 4 }]);

  for (const role of ['ACCOUNTANT', 'AUDITOR', 'SALES']) {
    setTestRole(role);
    assert.equal((await receive()).error, DENIED, role);
    assert.equal((await receivePurchaseOrder(s.order.id, s.warehouse.id)).error, DENIED, role);
  }
  assert.equal(await prisma.inventory.count(), 0);
  assert.equal(await prisma.inventoryMovement.count(), 0);
  assert.equal((await prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: s.order.items[0].id } })).receivedQuantity, 0);

  setTestRole('WAREHOUSE');
  const received = await receive();
  assert.equal(received.success, true, received.error);
  assert.equal((await prisma.inventory.findFirstOrThrow()).quantity, 4);
  const movement = await prisma.inventoryMovement.findFirstOrThrow();
  assert.equal(movement.note, `دریافت سفارش خرید #${s.order.number}`);
  // The landed cost itself still becomes the product's cost of record.
  assert.equal(Number((await prisma.product.findUniqueOrThrow({ where: { id: s.product.id } })).costPrice), 120_000);
});

test('payments take finance.manage, arrival costs take cost.edit and finance.manage, and only finance marks an order paid', async () => {
  const s = await seed();
  const pending = await s.order2('PENDING_PAYMENT');
  const producing = await s.order2('IN_PRODUCTION');
  const draft = await s.order2('DRAFT');
  const balance = async () => Number((await prisma.account.findUniqueOrThrow({ where: { id: s.account.id } })).balance);
  const status = async (id: string) => (await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } })).status;
  const pay = () => recordPurchasePartialPayment({ orderId: pending.id, accountId: s.account.id, amount: 100_000 });
  const arrive = () => recordArrival(producing.id, [{ title: 'حمل داخلی', amount: 10_000, currency: 'TOMAN' }], s.account.id);

  for (const role of ['WAREHOUSE', 'AUDITOR', 'SALES']) {
    setTestRole(role);
    assert.equal((await pay()).message, DENIED, role);
    assert.equal((await recordPurchasePayment(pending.id, s.account.id)).message, DENIED, role);
    assert.equal((await updatePurchaseOrderStatus(pending.id, 'PAID')).message, DENIED, role);
  }
  for (const role of ['ACCOUNTANT', 'WAREHOUSE', 'AUDITOR']) {
    setTestRole(role);
    assert.equal((await arrive()).message, DENIED, role);
  }
  setTestRole('AUDITOR');
  assert.equal((await updatePurchaseOrderStatus(draft.id, 'PENDING_PAYMENT')).message, DENIED);

  assert.equal(await balance(), BALANCE);
  assert.equal(await prisma.purchaseOrderPayment.count(), 1);
  assert.equal(await prisma.purchaseOrderArrivalCost.count(), 1);
  assert.deepEqual([await status(pending.id), await status(producing.id), await status(draft.id)], ['PENDING_PAYMENT', 'IN_PRODUCTION', 'DRAFT']);

  setTestRole('WAREHOUSE');
  assert.equal((await updatePurchaseOrderStatus(draft.id, 'PENDING_PAYMENT')).success, true);
  setTestRole('ACCOUNTANT');
  assert.equal((await pay()).success, true);
  assert.equal(await balance(), BALANCE - 100_000);
  setTestRole('ADMIN');
  assert.equal((await arrive()).success, true);
  assert.deepEqual([await status(pending.id), await status(producing.id), await status(draft.id)], ['PARTIALLY_PAID', 'ARRIVED', 'PENDING_PAYMENT']);
});
