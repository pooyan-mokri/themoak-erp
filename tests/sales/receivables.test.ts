import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { createOrder, getOrders } from '@/actions/sales';
import { getDashboardFinancials } from '@/actions/dashboard';
import { getARAgingReport } from '@/actions/invoice';
import { getBalanceSheet } from '@/actions/reports';
import { getBalanceSheet as getReportingBalanceSheet } from '@/actions/reporting';
import { calculateCustomerDebt, getCustomersWithDebt } from '@/actions/customer';
import { orderExportRow, orderRemaining } from '@/lib/order-list';
import { openAccount, stockIn } from './world';

// What customers owe is one figure (src/lib/order-balance.ts): the dashboard's «مطالبات», the aging report,
// the balance sheet on both report pages, the customers' debts and the order list all show the same amount.

console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

test('what customers owe is the same on the dashboard, the aging report, both balance sheets, the debtors and the order list', async () => {
  const store = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 1, sellPrice: 10_000_000 } });
  await stockIn(frame.id, store.id, 10);
  const till = await openAccount('صندوق', { type: 'CASH' });
  const [sara, reza, mina] = await Promise.all(['سارا', 'رضا', 'مینا'].map((name) => prisma.customer.create({ data: { name } })));
  const sell = async (customerId: string, discount: number, paid: number) => {
    const r = await createOrder({
      customerId, items: [{ productId: frame.id, quantity: 1, price: 10_000_000 }], paymentMethod: 'CASH',
      accountId: till.id, totalAmount: 10_000_000, discount, paidAmount: paid, warehouseId: store.id,
    });
    assert.equal(r.success, true, r.message);
  };
  // سارا: 10,000,000 less 1,000,000 off, 2,000,000 paid: owes 7,000,000 (not 8,000,000).
  await sell(sara.id, 1_000_000, 2_000_000);
  // رضا: an old WooCommerce order, stored after its 500,000 discount: owes its 5,000,000, not 4,500,000.
  await prisma.order.create({ data: { customerId: reza.id, wooId: 901, totalAmount: 5_000_000, discount: 500_000, paidAmount: 0, paymentStatus: 'UNPAID', status: 'COMPLETED' } });
  // مینا: paid beyond the net (a credit), and a cancelled order: owes nothing.
  await prisma.order.create({ data: { customerId: mina.id, totalAmount: 3_000_000, discount: 0, paidAmount: 3_500_000, paymentStatus: 'PAID', status: 'COMPLETED' } });
  await prisma.order.create({ data: { customerId: mina.id, totalAmount: 9_000_000, discount: 0, paidAmount: 0, paymentStatus: 'UNPAID', status: 'CANCELLED' } });
  // A guest sale on credit is not a customer's debt.
  await prisma.order.create({ data: { totalAmount: 4_000_000, discount: 0, paidAmount: 0, paymentStatus: 'UNPAID', status: 'COMPLETED' } });
  // A payment status left stale (PAID with money still owed) does not hide the debt.
  await prisma.order.create({ data: { customerId: reza.id, totalAmount: 1_000_000, discount: 0, paidAmount: 400_000, paymentStatus: 'PAID', status: 'COMPLETED' } });

  const owed = 7_000_000 + 5_000_000 + 600_000;
  const aging = await getARAgingReport();
  const debtors = await getCustomersWithDebt();
  assert.deepEqual(
    {
      dashboard: (await getDashboardFinancials()).totalReceivables,
      aging: aging.reduce((sum: number, row: any) => sum + row.totalDue, 0),
      balanceSheet: (await getBalanceSheet(new Date())).assets.accountsReceivable,
      reportingPage: (await getReportingBalanceSheet()).assets.accountsReceivable,
      debtors: debtors.reduce((sum: number, row: any) => sum + row.totalDebt, 0),
      perCustomer: [await calculateCustomerDebt(sara.id), await calculateCustomerDebt(reza.id), await calculateCustomerDebt(mina.id)],
    },
    { dashboard: owed, aging: owed, balanceSheet: owed, reportingPage: owed, debtors: owed, perCustomer: [7_000_000, 5_600_000, 0] },
  );
  // The order list and its Excel export: the same per order, and nothing below 0.
  const orders = (await getOrders()) as any[];
  const listed = orders.filter((order) => order.customerId).reduce((sum, order) => sum + orderRemaining(order), 0);
  assert.equal(listed, owed);
  for (const order of orders) assert.equal(orderExportRow(order)['باقیمانده (تومان)'], orderRemaining(order));
  assert.ok(orders.every((order) => orderRemaining(order) >= 0));
});
