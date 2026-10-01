import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { prisma, resetDatabase } from '../helpers/db';
import { openAccount } from '../accounting/ledger';
import { balances, changedTables, sqlFile, tableHashes } from './sql';
import { order121, pettyAccount, pettyCashAdvances, showroomDeposit } from './real-shapes';

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
  // One of each problem, in the real data's shape.
  const user = await prisma.user.create({ data: { name: 'Ali', email: 'Ali@TheMoak.com', password: 'x' } });
  await prisma.passwordResetToken.create({ data: { userId: user.id, token: 't', expiresAt: new Date(Date.now() + 86_400_000) } });
  await prisma.activityLog.create({ data: { action: 'CREATE_USER', details: 'کاربر علی با نقش ADMIN ایجاد شد.' } });
  const usd = await prisma.account.create({ data: { name: 'دلاری', type: 'BANK', currency: 'USD', balance: 100 } });
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 222_000, date: new Date('2026-09-01') } });
  await prisma.transaction.create({ data: { type: 'ADJUSTMENT', currency: 'USD', amount: 100, amountInToman: 100, accountId: usd.id, date: new Date('2026-09-21') } });
  await openAccount('novin', 3_000_000_000);
  await showroomDeposit('novin');
  const petty = await pettyAccount();
  const advances = await pettyCashAdvances('novin', 'novin');
  const { order: order121Row } = await order121('novin');
  const supplier = await prisma.supplier.create({ data: { name: 'Mellume' } });
  await prisma.purchaseOrder.create({ data: { number: 1, supplierId: supplier.id, status: 'RECEIVED', totalAmount: 75_000_000, totalAmountInToman: 75_000_000 } });
  const shop = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const product = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 400_000, sellPrice: 1 } });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: shop.id, quantity: 4 } });
  const sale = await prisma.order.create({
    data: { totalAmount: 1, items: { create: [{ productId: product.id, quantity: 1, price: 1, warehouseId: shop.id }] } },
  });
  // A WooCommerce order stored in 1404 AD, booked on the order date by the COGS and stock fixes after it.
  const woo = await prisma.order.create({
    data: { totalAmount: 1, wooId: 79, createdAt: new Date('1404-09-28T18:22:36Z'), items: { create: [{ productId: product.id, quantity: 1, price: 1, warehouseId: shop.id }] } },
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
  assert.equal((await prisma.activityLog.findFirstOrThrow()).details, 'کاربر علی با نقش مدیر سیستم ایجاد شد.');
  assert.equal(Number((await prisma.transaction.findFirstOrThrow({ where: { accountId: usd.id } })).amountInToman), 22_200_000);
  assert.deepEqual(
    (await prisma.transaction.groupBy({ by: ['category'], where: { description: { contains: 'ودیعه' } }, _sum: { amount: true } }))
      .map((g: any) => [g.category, Number(g._sum.amount)]).sort(),
    [['بازپرداخت قرض شریک', 1_034_000_000], ['قرض به شریک', 1_034_000_000], ['ودیعه اجاره', 505_000_000]],
  );
  assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: advances.booom.id } })).category, 'برداشت شریک');
  assert.equal(await prisma.account.count({ where: { name: 'تنخواه showroom' } }), 0);
  // Every account keeps its balance but «تنخواه» (+170M of advances) and the order-121 account (−2M);
  // the COGS fix made its account.
  const now = await balances();
  assert.deepEqual(
    Object.fromEntries(Object.keys(accounts).map((id) => [id, now[id] - accounts[id]]).filter(([, d]) => d !== 0)),
    { [petty]: 170_000_000, novin: -2_000_000 },
  );
  assert.deepEqual(Object.keys(now).filter((id) => !(id in accounts)), ['cogs-account']);
  assert.deepEqual(
    [Number((await prisma.order.findUniqueOrThrow({ where: { id: order121Row.id } })).paidAmount)],
    [16_000_000],
  );
  assert.equal(await prisma.purchaseOrderPayment.count({ where: { accountId: null } }), 1);
  assert.equal(await prisma.transaction.count({ where: { orderId: sale.id, category: 'COGS' } }), 1);
  assert.equal(await prisma.inventoryMovement.count({ where: { referenceId: sale.id, type: 'SALE' } }), 1);
  // The 1404 AD order is 2025-12-19 now, and so are the rows booked at its date.
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: woo.id } })).createdAt.toISOString(), '2025-12-19T18:22:36.000Z');
  assert.equal((await prisma.transaction.findFirstOrThrow({ where: { orderId: woo.id, category: 'COGS' } })).date.toISOString(), '2025-12-19T18:22:36.000Z');
  assert.equal((await prisma.inventory.findFirstOrThrow()).quantity, 4);

  await runAll();
  assert.deepEqual(changedTables(once, await tableHashes()), []);
});
