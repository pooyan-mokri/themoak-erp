import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import {
  getPendingSettlements,
  markSettlementPaidOutside,
  paySettlement,
  recordConsignmentSales,
} from '@/actions/consignment';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/** محو on 25%: one frame sold at 1,000,000 (we are owed 750,000), 300,000 of it already paid into the bank. */
async function partlyPaidInvoice() {
  await prisma.user.create({ data: { id: 'test-user', name: 'Test', email: 'test@example.com', password: 'x' } });
  const customer = await prisma.customer.create({ data: { name: 'محو', commissionRate: 25 } });
  const warehouse = await prisma.warehouse.create({ data: { name: 'انبار امانی - محو', isVirtual: true, customerId: customer.id } });
  const frame = await prisma.product.create({ data: { name: 'CHAR', sku: 'CHAR', costPrice: 200_000, sellPrice: 1_000_000 } });
  await prisma.inventory.create({ data: { productId: frame.id, warehouseId: warehouse.id, quantity: 5 } });
  const bank = await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  await recordConsignmentSales({ partnerWarehouseId: warehouse.id, saleDate: '2026-05-19', items: [{ productId: frame.id, quantity: 1, unitPrice: 1_000_000 }] });
  const order = await prisma.order.findFirstOrThrow();
  assert.equal((await paySettlement(undefined, form({ orderId: order.id, accountId: bank.id, amount: '300000' }))).success, true);
  return { order, bank };
}

/** Everything this must never touch. */
const books = async () => ({
  transactions: await prisma.transaction.count(),
  balances: (await prisma.account.findMany({ orderBy: { name: 'asc' } })).map((a: any) => Number(a.balance)),
  stock: (await prisma.inventory.findMany()).map((i: any) => i.quantity),
  movements: await prisma.inventoryMovement.count(),
});

test('an invoice settled outside the ERP is closed without any money, balance or stock moving', async () => {
  const { order } = await partlyPaidInvoice();
  const before = await books();

  const closed = await markSettlementPaidOutside(order.id, 450_000);
  assert.equal(closed.success, true, closed.message);

  const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(after.paymentStatus, 'PAID');
  assert.equal(Number(after.paidAmount), 750_000);
  assert.ok(after.tags.includes('تسویه بیرون از سیستم'));
  assert.deepEqual(await books(), before, 'no money row, no balance, no stock');
  assert.equal((await getPendingSettlements()).length, 0);
  assert.equal(await prisma.activityLog.count({ where: { action: 'SETTLE_OUTSIDE' } }), 1);

  assert.match((await markSettlementPaidOutside(order.id, 0)).message ?? '', /مانده‌ای ندارد/);
});

test('only an admin closes an invoice this way, and only at the remaining amount the screen showed', async () => {
  const { order } = await partlyPaidInvoice();
  const before = await books();

  for (const role of ['ACCOUNTANT', 'SALES', 'AUDITOR', null]) {
    setTestRole(role);
    assert.match((await markSettlementPaidOutside(order.id, 450_000)).message ?? '', /فقط مدیر سیستم/, String(role));
  }
  setTestRole('ADMIN');
  assert.match((await markSettlementPaidOutside(order.id, 750_000)).message ?? '', /تغییر کرده است/);

  const still = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(still.paymentStatus, 'PARTIAL');
  assert.equal(Number(still.paidAmount), 300_000);
  assert.deepEqual(await books(), before);
});
