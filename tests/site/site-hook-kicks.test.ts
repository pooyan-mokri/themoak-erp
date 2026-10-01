import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase } from '../helpers/db';
import { kickSiteHook } from '@/lib/site-hook';
import { createOrder } from '@/actions/sales';

beforeEach(async () => {
  delete process.env.VERCEL_ENV;
  delete process.env.APP_ENV;
  delete process.env.VERCEL;
  await resetDatabase();
});
after(async () => {
  delete process.env.VERCEL_ENV;
  delete process.env.APP_ENV;
  delete process.env.VERCEL;
  await prisma.$disconnect();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => Promise<boolean>, ms = 5_000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) assert.fail('timed out');
    await sleep(50);
  }
}

test('outside the live ERP a kick starts no drain', async () => {
  await prisma.product.create({ data: { name: 'PANJ - Blue', sku: 'PANJ/BLUE', webId: 'MOAK-PANJ-BLUE', costPrice: 1, sellPrice: 1 } });
  // The trigger's 'webid' row. A drain would take the lease and, with pushing off, empty the log.
  assert.equal(await prisma.siteHookLog.count(), 1);

  // Development, a Vercel preview, a host that is not the live one.
  for (const env of [{}, { VERCEL: '1', VERCEL_ENV: 'preview' }, { APP_ENV: 'staging' }, { APP_ENV: 'Production ' }]) {
    Object.assign(process.env, env);
    kickSiteHook();
    await sleep(300);
    assert.equal(await prisma.siteHookLease.count(), 0, `no drain took the lease (${JSON.stringify(env)})`);
    assert.equal(await prisma.siteHookLog.count(), 1, `no drain read the log (${JSON.stringify(env)})`);
    for (const key of Object.keys(env)) delete process.env[key];
  }

  // The same signs do show when a drain runs.
  process.env.VERCEL_ENV = 'production';
  kickSiteHook();
  await until(async () => (await prisma.siteHookLog.count()) === 0 && (await prisma.siteHookLease.findFirst())?.holder === null);
});

/** A POS sale of 2 of a frame with 5 in stock, with the log emptied before it. */
async function posSale() {
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const product = await prisma.product.create({
    data: { name: 'DAMN RAW - White', sku: 'RAW/WHIT', webId: 'MOAK-DAMN-RAW-WHITE', costPrice: 1, sellPrice: 1000 },
  });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: warehouse.id, quantity: 5 } });
  const account = await prisma.account.create({ data: { name: 'صندوق', type: 'CASH', currency: 'TOMAN', balance: 0 } });
  const customer = await prisma.customer.create({ data: { name: 'سارا' } });
  await prisma.siteHookLog.deleteMany();

  const result = await createOrder({
    customerId: customer.id,
    items: [{ productId: product.id, quantity: 2, price: 1000 }],
    paymentMethod: 'CASH',
    accountId: account.id,
    totalAmount: 2000,
    warehouseId: warehouse.id,
  });
  return { warehouse, product, result };
}

test('a POS sale still succeeds, and its stock change reaches the log through the trigger', async () => {
  const { warehouse, product, result } = await posSale();
  assert.equal(result.success, true, result.message);
  const stock = await prisma.inventory.findUniqueOrThrow({
    where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
  });
  assert.equal(stock.quantity, 3);

  await sleep(300);
  assert.deepEqual(
    await prisma.siteHookLog.findMany({ select: { productId: true, kind: true, warehouseId: true, oldWebId: true } }),
    [{ productId: product.id, kind: 'stock', warehouseId: warehouse.id, oldWebId: null }],
  );
  assert.equal(await prisma.siteHookLease.count(), 0, 'the kick in createOrder started no drain');
});

test('on Vercel production the kick in a POS sale runs a drain, which with pushing off empties the log', async () => {
  const previous = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = 'production';
  try {
    const { result } = await posSale();
    assert.equal(result.success, true, result.message);
    // No site connection is saved, so pushing is off. Only a drain takes the lease and empties the log.
    await until(async () => (await prisma.siteHookLog.count()) === 0 && (await prisma.siteHookLease.findFirst())?.holder === null);
    assert.equal(await prisma.siteHookLog.count(), 0);
    assert.equal(await prisma.siteHookLease.count(), 1, 'the drain took the lease and gave it back');
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
});

test('on Liara (APP_ENV=production, no Vercel variables) the kick in a POS sale runs a drain in the background', async () => {
  process.env.APP_ENV = 'production';
  try {
    const { result } = await posSale();
    assert.equal(result.success, true, result.message);
    // A long-running server has no waitUntil: the drain simply carries on after the sale has answered.
    await until(async () => (await prisma.siteHookLog.count()) === 0 && (await prisma.siteHookLease.findFirst())?.holder === null);
    assert.equal(await prisma.siteHookLease.count(), 1, 'the drain took the lease and gave it back');
  } finally {
    delete process.env.APP_ENV;
  }
});

test('on a long-running server many kicks at once run one drain at a time, all settle, and nothing is left rejected', async () => {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  process.on('unhandledRejection', onRejection);
  process.env.APP_ENV = 'production';
  try {
    for (let i = 0; i < 5; i++) {
      await prisma.product.create({ data: { name: `P${i}`, sku: `P/${i}`, webId: `MOAK-P-${i}`, costPrice: 1, sellPrice: 1 } });
    }
    assert.equal(await prisma.siteHookLog.count(), 5);
    for (let i = 0; i < 25; i++) kickSiteHook();
    await until(async () => (await prisma.siteHookLog.count()) === 0 && (await prisma.siteHookLease.findFirst())?.holder === null);
    // Kicks that found the lease taken returned at once; the one drain that held it gave it back.
    await sleep(500);
    assert.equal((await prisma.siteHookLease.findFirst())?.holder, null);
    assert.deepEqual(rejections, []);
  } finally {
    delete process.env.APP_ENV;
    process.off('unhandledRejection', onRejection);
  }
});
