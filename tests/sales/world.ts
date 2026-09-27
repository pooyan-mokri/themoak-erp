import assert from 'node:assert/strict';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../helpers/db';
import { sumBalanceEffects } from '@/lib/balance-reconciliation';

/** Every role in src/lib/permissions.ts, and a signed-out visitor (null). */
export const DENIED = 'شما به این بخش دسترسی ندارید.';
/** Hold sales.manage. */
export const SELLERS = ['ADMIN', 'ACCOUNTANT', 'SALES'] as const;
/** Do not hold sales.manage. */
export const NON_SELLERS = ['AUDITOR', 'WAREHOUSE', 'PROJECT_MANAGER', 'USER', null] as const;
/** Hold sales.view. */
export const VIEWERS = ['ADMIN', 'AUDITOR', 'ACCOUNTANT', 'SALES'] as const;
/** Do not hold sales.view. */
export const NON_VIEWERS = ['WAREHOUSE', 'PROJECT_MANAGER', 'USER', null] as const;

/** The consignment COGS and commission rows sit on EXPENSE accounts kept at 0: they never move a balance. */
const BUCKET_CATEGORIES = ['COGS', 'CONSIGNMENT_COMMISSION'];
const movesBalance = (account: { type: string }, row: { category: string | null }) =>
  !(account.type === 'EXPENSE' && BUCKET_CATEGORIES.includes(row.category ?? ''));

/** An account whose opening balance is booked as its first ledger row, so its ledger adds up from the start. */
export async function openAccount(name: string, opts: { type?: string; currency?: string; opening?: number } = {}) {
  const { type = 'BANK', currency = 'TOMAN', opening = 0 } = opts;
  const account = await prisma.account.create({ data: { name, type, currency: currency as any, balance: opening } });
  if (opening) {
    await prisma.transaction.create({
      data: { type: 'ADJUSTMENT', amount: opening, amountInToman: opening, currency: currency as any, accountId: account.id, category: 'موجودی اولیه', description: 'موجودی اولیه' },
    });
  }
  return account;
}

/** `quantity` units of a product brought into a warehouse, with the movement that brought them. */
export async function stockIn(productId: string, warehouseId: string, quantity: number) {
  await prisma.inventory.upsert({
    where: { productId_warehouseId: { productId, warehouseId } },
    update: { quantity: { increment: quantity } },
    create: { productId, warehouseId, quantity },
  });
  await prisma.inventoryMovement.create({ data: { productId, toWarehouseId: warehouseId, quantity, type: 'PURCHASE', note: 'موجودی اولیه' } });
}

export async function quantityOf(productId: string, warehouseId: string) {
  const row = await prisma.inventory.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
  return row?.quantity ?? 0;
}

export async function balanceOf(accountId: string) {
  return Number((await prisma.account.findUniqueOrThrow({ where: { id: accountId } })).balance);
}

/** Every account's stored balance equals the signed sum of the rows that moved it. */
export async function assertLedger() {
  const accounts = await prisma.account.findMany({ include: { transactions: true } });
  for (const account of accounts) {
    const rows = account.transactions.filter((row: any) => movesBalance(account, row));
    const drift = new Decimal(account.balance as any).minus(sumBalanceEffects(rows as any));
    assert.equal(Number(drift), 0, `«${account.name}»: balance ${account.balance} does not match its ledger`);
  }
}

/** Every stock row equals what its movements brought in less what they took out, and none is negative. */
export async function assertStockMatchesMovements() {
  const [inventory, movements] = await Promise.all([prisma.inventory.findMany(), prisma.inventoryMovement.findMany()]);
  for (const row of inventory) {
    const net = movements.reduce((sum: number, m: any) => {
      if (m.productId !== row.productId) return sum;
      if (m.toWarehouseId === row.warehouseId) sum += m.quantity;
      if (m.fromWarehouseId === row.warehouseId) sum -= m.quantity;
      return sum;
    }, 0);
    assert.equal(row.quantity, net, `stock of ${row.productId} in ${row.warehouseId}: ${row.quantity}, movements say ${net}`);
    assert.ok(row.quantity >= 0, `negative stock of ${row.productId} in ${row.warehouseId}`);
  }
}

/**
 * Each order's paidAmount is the money its rows brought in, less what they paid back,
 * and its paymentStatus follows what is still owed (never below 0 for the status).
 * An order closed outside the ERP carries its tag and no money row by design.
 */
export async function assertOrderMoney() {
  const orders = await prisma.order.findMany();
  for (const order of orders) {
    const rows = await prisma.transaction.findMany({
      where: { OR: [{ orderId: order.id }, ...(order.transactionId ? [{ id: order.transactionId }] : [])] },
    });
    const received = rows
      .filter((row: any) => !BUCKET_CATEGORIES.includes(row.category ?? ''))
      .reduce((sum: number, row: any) => sum + (row.type === 'INCOME' ? 1 : row.type === 'EXPENSE' ? -1 : 0) * Number(row.amountInToman), 0);
    const paid = Number(order.paidAmount);
    if (!order.tags.includes('تسویه بیرون از سیستم')) {
      assert.ok(Math.abs(paid - received) < 0.01, `order #${order.number}: paidAmount ${paid}, its rows ${received}`);
    }
    if (order.status === 'CANCELLED') continue;
    const owed = Math.max(0, Number(order.totalAmount) - Number(order.discount) - paid);
    const status = owed > 0.01 ? (paid > 0 ? 'PARTIAL' : 'UNPAID') : 'PAID';
    assert.equal(order.paymentStatus, status, `order #${order.number}: owes ${owed} but is ${order.paymentStatus}`);
  }
}

/** All three, after a scenario. */
export async function assertInvariants(opts: { stock?: boolean } = {}) {
  await assertLedger();
  await assertOrderMoney();
  if (opts.stock !== false) await assertStockMatchesMovements();
}

/** Everything a refused write must leave alone. */
export async function snapshot() {
  return JSON.parse(
    JSON.stringify({
      customers: await prisma.customer.findMany({ orderBy: { id: 'asc' } }),
      orders: await prisma.order.findMany({ include: { items: true, commissions: true }, orderBy: { id: 'asc' } }),
      transactions: await prisma.transaction.findMany({ orderBy: { id: 'asc' } }),
      accounts: await prisma.account.findMany({ orderBy: { id: 'asc' } }),
      inventory: await prisma.inventory.findMany({ orderBy: [{ productId: 'asc' }, { warehouseId: 'asc' }] }),
      movements: await prisma.inventoryMovement.findMany({ orderBy: { id: 'asc' } }),
      channels: await prisma.consignmentChannel.findMany({ orderBy: { id: 'asc' } }),
      warehouses: await prisma.warehouse.findMany({ orderBy: { id: 'asc' } }),
      activity: await prisma.activityLog.findMany({ orderBy: { id: 'asc' } }),
      leads: await prisma.lead.findMany({ orderBy: { id: 'asc' } }),
      deals: await prisma.deal.findMany({ orderBy: { id: 'asc' } }),
      tickets: await prisma.supportTicket.findMany({ orderBy: { id: 'asc' } }),
      promotions: await prisma.promotion.findMany({ orderBy: { id: 'asc' } }),
      campaigns: await prisma.marketingCampaign.findMany({ orderBy: { id: 'asc' } }),
      gifts: await prisma.marketingGift.findMany({ orderBy: { id: 'asc' } }),
    }),
  );
}

export const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
