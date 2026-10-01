import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { prisma, resetDatabase } from '../helpers/db';
import { balances, changedTables, sqlFile, tableHashes } from './sql';

// prisma/sql/datafix-2026-10-01-ALL.sql: every fix of 2026-10-01, in one transaction, in a safe order.

beforeEach(() => resetDatabase());
after(() => prisma.$disconnect());

const RUNNER = 'datafix-2026-10-01-ALL.sql';
const included = () => [...sqlFile(RUNNER).matchAll(/^\\ir (\S+)$/gm)].map((m) => m[1]);

test('the runner applies every fix of the day once, between BEGIN and COMMIT, stopping on the first error', () => {
  const fixes = readdirSync(join(process.cwd(), 'prisma/sql')).filter((f) => f.startsWith('datafix-2026-10-01-') && f !== RUNNER);
  assert.deepEqual([...included()].sort(), fixes.sort());
  assert.equal(new Set(included()).size, included().length);
  const body = sqlFile(RUNNER).split('\n').filter((line) => line && !line.startsWith('--'));
  assert.deepEqual(body.slice(0, 3), ['\\set ON_ERROR_STOP on', 'BEGIN;', "SET LOCAL lock_timeout = '10s';"]);
  assert.equal(body.at(-1), 'COMMIT;');
  // Nothing of the build runs a data fix.
  const pkg = sqlFile('../../package.json');
  assert.ok(!pkg.includes('datafix-'));
});

test('run in its order in one transaction, the fixes change what they should; a second run changes nothing', async () => {
  // One of each problem.
  const user = await prisma.user.create({ data: { name: 'Ali', email: 'Ali@TheMoak.com', password: 'x' } });
  await prisma.passwordResetToken.create({ data: { userId: user.id, token: 't', expiresAt: new Date(Date.now() + 86_400_000) } });
  const usd = await prisma.account.create({ data: { name: 'دلاری', type: 'BANK', currency: 'USD', balance: 100 } });
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 222_000, date: new Date('2026-09-01') } });
  await prisma.transaction.create({ data: { type: 'ADJUSTMENT', currency: 'USD', amount: 100, amountInToman: 100, accountId: usd.id, date: new Date('2026-09-21') } });
  const bank = await prisma.account.create({ data: { name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  const expense = (category: string, text: string, amount: number) =>
    prisma.transaction.create({ data: { type: 'EXPENSE', category, description: `${category} - ${text}`, amount, amountInToman: amount, accountId: bank.id } });
  await expense('Rent', 'بخشی از ودیعه showroom', 500_000_000);
  await expense('Other', 'تنخواه اول SHOWROOM', 50_000_000);
  await prisma.account.update({ where: { id: bank.id }, data: { balance: -550_000_000 } });
  const supplier = await prisma.supplier.create({ data: { name: 'Mellume' } });
  await prisma.purchaseOrder.create({ data: { number: 1, supplierId: supplier.id, status: 'RECEIVED', totalAmount: 75_000_000, totalAmountInToman: 75_000_000 } });
  const shop = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const product = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 400_000, sellPrice: 1 } });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: shop.id, quantity: 4 } });
  const sale = await prisma.order.create({
    data: { totalAmount: 1, items: { create: [{ productId: product.id, quantity: 1, price: 1, warehouseId: shop.id }] } },
  });
  const accounts = await balances();

  const runAll = () =>
    prisma.$transaction(async (tx: any) => {
      for (const file of included()) await tx.$executeRawUnsafe(sqlFile(file));
    });
  await runAll();
  const once = await tableHashes();

  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email, 'ali@themoak.com');
  assert.equal(await prisma.passwordResetToken.count({ where: { expiresAt: { gt: new Date() } } }), 0);
  assert.equal(Number((await prisma.transaction.findFirstOrThrow({ where: { accountId: usd.id } })).amountInToman), 22_200_000);
  assert.equal(await prisma.transaction.count({ where: { category: 'ودیعه اجاره' } }), 1);
  const petty = await prisma.account.findFirstOrThrow({ where: { name: 'تنخواه showroom' } });
  assert.equal(Number(petty.balance), 50_000_000);
  // Every account that was there keeps its balance; the fixes made the petty-cash and COGS accounts.
  const now = await balances();
  assert.deepEqual(Object.fromEntries(Object.keys(accounts).map((id) => [id, now[id]])), accounts);
  assert.deepEqual(Object.keys(now).filter((id) => !(id in accounts)).sort(), [petty.id, 'cogs-account'].sort());
  assert.equal(await prisma.purchaseOrderPayment.count({ where: { accountId: null } }), 1);
  assert.equal(await prisma.transaction.count({ where: { orderId: sale.id, category: 'COGS' } }), 1);
  assert.equal(await prisma.inventoryMovement.count({ where: { referenceId: sale.id, type: 'SALE' } }), 1);
  assert.equal((await prisma.inventory.findFirstOrThrow()).quantity, 4);

  await runAll();
  assert.deepEqual(changedTables(once, await tableHashes()), []);
});
