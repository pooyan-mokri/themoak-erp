import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { AccessDenied } from '@/lib/access';
import * as reporting from '@/actions/reporting';
import * as reports from '@/actions/reports';
import { getSalesByProduct as getAccountingSalesByProduct } from '@/actions/accounting';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

const COST = 3_456_789;
const PRICE = 9_876_543;

/** One product in stock, sold once. */
async function seedSale() {
  const warehouse = await prisma.warehouse.create({ data: { name: 'Main' } });
  const product = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ-1', costPrice: COST, sellPrice: PRICE } });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: 3 } });
  await prisma.order.create({
    data: {
      totalAmount: PRICE,
      status: 'COMPLETED',
      items: { create: [{ productId: product.id, warehouseId: warehouse.id, quantity: 1, price: PRICE }] },
    },
  });
  await prisma.transaction.create({
    data: { type: 'INCOME', amount: PRICE, amountInToman: PRICE, currency: 'TOMAN', category: 'Sales' },
  });
}

const ROLES = ['ADMIN', 'AUDITOR', 'ACCOUNTANT', 'SALES', 'WAREHOUSE', 'PROJECT_MANAGER', 'USER'];
const monthAgo = () => new Date(Date.now() - 30 * 86400000);
const tomorrow = () => new Date(Date.now() + 86400000);

/** Each getter, with the roles that may call it. */
const GETTERS: [string, () => Promise<unknown>, string[]][] = [
  ['reporting.getProfitAndLoss', () => reporting.getProfitAndLoss(), ['ADMIN', 'AUDITOR']],
  ['reporting.getBalanceSheet', () => reporting.getBalanceSheet(), ['ADMIN', 'AUDITOR']],
  ['reporting.getInventoryValuation', () => reporting.getInventoryValuation(), ['ADMIN', 'AUDITOR']],
  ['reporting.getSalesPerformance', () => reporting.getSalesPerformance(), ['ADMIN', 'AUDITOR', 'ACCOUNTANT', 'SALES']],
  ['reporting.getSalesByCustomer', () => reporting.getSalesByCustomer(), ['ADMIN', 'AUDITOR', 'ACCOUNTANT', 'SALES']],
  ['reports.getProfitLossReport', () => reports.getProfitLossReport(monthAgo(), tomorrow()), ['ADMIN', 'AUDITOR']],
  ['reports.getBalanceSheet', () => reports.getBalanceSheet(tomorrow()), ['ADMIN', 'AUDITOR']],
  ['reports.getStockTurnoverReport', () => reports.getStockTurnoverReport(), ['ADMIN', 'AUDITOR']],
  ['reports.getInventoryAgingReport', () => reports.getInventoryAgingReport(), ['ADMIN', 'AUDITOR']],
  ['reports.getSalesByProduct', () => reports.getSalesByProduct(monthAgo(), tomorrow()), ['ADMIN', 'AUDITOR', 'ACCOUNTANT', 'SALES']],
  ['reports.getSalesByCustomer', () => reports.getSalesByCustomer(monthAgo(), tomorrow()), ['ADMIN', 'AUDITOR', 'ACCOUNTANT', 'SALES']],
  ['reports.getSalesOverTime', () => reports.getSalesOverTime(monthAgo(), tomorrow()), ['ADMIN', 'AUDITOR', 'ACCOUNTANT', 'SALES']],
  ['accounting.getSalesByProduct', () => getAccountingSalesByProduct(), ['ADMIN', 'AUDITOR', 'ACCOUNTANT', 'SALES']],
];

test('profit, balance sheet and inventory value reports refuse every role but ADMIN and AUDITOR; sales reports need sales.view', async () => {
  await seedSale();
  for (const [name, call, allowed] of GETTERS) {
    for (const role of ROLES) {
      setTestRole(role);
      const label = `${name} / ${role}`;
      if (allowed.includes(role)) {
        await call();
      } else {
        await assert.rejects(call(), (error: unknown) => {
          assert.ok(error instanceof AccessDenied, label);
          return true;
        });
      }
    }
  }
});

test('sales reports carry revenue only, never cost or profit', async () => {
  await seedSale();
  setTestRole('SALES');
  const byProduct = await reports.getSalesByProduct(monthAgo(), tomorrow());
  assert.deepEqual(byProduct, [{ name: 'PANJ', quantity: 1, revenue: PRICE }]);
  const performance = await reporting.getSalesPerformance();
  assert.deepEqual(performance.topProducts, [{ name: 'PANJ', quantity: 1, total: PRICE }]);
  const overTime = await reports.getSalesOverTime(monthAgo(), tomorrow());
  for (const served of [byProduct, performance, overTime, await getAccountingSalesByProduct()]) {
    assert.equal(JSON.stringify(served).includes(String(COST)), false);
  }
});

test('a cost viewer still gets the valuation and the profit', async () => {
  await seedSale();
  setTestRole('AUDITOR');
  assert.equal((await reporting.getInventoryValuation()).totalValue, 3 * COST);
  assert.equal((await reports.getInventoryAgingReport())[0].value, 3 * COST);
  assert.equal((await reporting.getProfitAndLoss()).netProfit, PRICE);
});
