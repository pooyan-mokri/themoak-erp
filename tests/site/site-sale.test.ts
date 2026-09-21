import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { GET, POST } from '@/app/api/erp/route';
import { normalizeMobile } from '@/lib/site-sale';
import { SITE_UNKNOWN_SKU, TAG_NEEDS_REVIEW, TAG_STOCK_SHORTAGE, readSiteOrderData } from '@/lib/site-sale-data';
import { balanceEffect } from '@/lib/balance-reconciliation';
import { getCustomersWithDebt } from '@/actions/customer';

const TOKEN = 'site-sale-test-token';
const OPENING = 1_000_000;

let world: {
  account: { id: string };
  mashahir: { id: string };
  central: { id: string };
  panj: { id: string };
  raw: { id: string };
};

beforeEach(async () => {
  process.env.ERP_API_SECRET = TOKEN;
  beforeQuery.fn = null;
  setTestRole('ADMIN');
  await resetDatabase();
  const account = await prisma.account.create({
    data: { name: 'بانک سامان', type: 'BANK', currency: 'TOMAN', balance: OPENING },
  });
  const mashahir = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const central = await prisma.warehouse.create({ data: { name: 'انبار مرکزی' } });
  const panj = await prisma.product.create({
    data: { name: 'PANJ - Blue', sku: 'PANJ/BLUE', webId: 'MOAK-PANJ-BLUE', costPrice: 1, sellPrice: 15_700_000 },
  });
  const raw = await prisma.product.create({
    data: { name: 'DAMN RAW - White', sku: 'RAW/WHIT', webId: 'MOAK-DAMN-RAW-WHITE', costPrice: 1, sellPrice: 18_500_000 },
  });
  await prisma.inventory.createMany({
    data: [
      { productId: panj.id, warehouseId: mashahir.id, quantity: 5 },
      { productId: panj.id, warehouseId: central.id, quantity: 100 },
      { productId: raw.id, warehouseId: mashahir.id, quantity: 1 },
    ],
  });
  world = { account, mashahir, central, panj, raw };
});
after(async () => {
  await prisma.$disconnect();
});

function call(action: string, body: Record<string, unknown>) {
  return POST(
    new NextRequest('http://localhost/api/erp', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    }),
  );
}

async function sell(body: Record<string, unknown>) {
  const res = await call('createSale', body);
  return { status: res.status, body: await res.json() };
}

async function status(body: Record<string, unknown>) {
  const res = await call('setSaleStatus', body);
  return { status: res.status, body: await res.json() };
}

let counter = 0;
/** A body shaped exactly like docs/erp-prompt.md §3. */
const GATEWAY_PAYMENT = { gateway: 'zibal', trackId: 'T1', refNumber: 'R1', paidAt: '2026-09-10T18:41:55.000Z', amount: 18_950_000 };

function saleBody(overrides: Record<string, unknown> = {}): Record<string, any> {
  counter += 1;
  return {
    reference: `M-TEST${counter}`,
    issuedAt: '2026-09-10T18:42:11.000Z',
    tag: 'website',
    warehouseId: world.mashahir.id,
    customer: { name: 'سارا', mobile: '09123456789', email: null, siteId: 'site-user-1', ordersBefore: 0 },
    shipTo: { province: 'تهران', city: 'تهران', address: 'خیابان ولیعصر', postal: '1234567890', note: null },
    shipping: { zone: 'tehran', carrier: 'تیپاکس', freight: 450_000, free: false, trackingCode: null },
    items: [
      {
        webId: 'MOAK-DAMN-RAW-WHITE',
        erpId: 'MOAK-DAMN-RAW-WHITE',
        sku: null,
        productId: 'site-product-1',
        name: 'DAMN RAW - White',
        quantity: 1,
        unitPrice: 18_500_000,
        lineTotal: 18_500_000,
      },
    ],
    subtotal: 18_500_000,
    discount: 0,
    coupon: null,
    total: 18_950_000,
    currency: 'toman',
    ...overrides,
    // A test that changes the payment keeps the gateway trace unless it overrides it too:
    // a payment without a trackId books no income (src/lib/site-sale.ts).
    payment:
      overrides.payment === null
        ? null
        : { ...GATEWAY_PAYMENT, ...((overrides.payment as Record<string, unknown> | undefined) ?? {}) },
  };
}

const orderOf = (reference: string) =>
  prisma.order.findUniqueOrThrow({
    where: { siteReference: reference },
    include: { items: true, siteRefunds: true, transaction: true },
  });

async function qty(productId: string, warehouseId: string) {
  const row = await prisma.inventory.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
  return row ? row.quantity : null;
}

async function balance() {
  return Number((await prisma.account.findUniqueOrThrow({ where: { id: world.account.id } })).balance);
}

/** Account.balance == opening + what its transactions did. */
async function assertBooksBalance() {
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: world.account.id },
    include: { transactions: true },
  });
  const derived = OPENING + account.transactions.reduce((sum: number, t: any) => sum + balanceEffect(t), 0);
  assert.equal(Number(account.balance), derived, 'Account.balance must equal opening + its transactions');
}

async function debtOf(customerId: string) {
  const row = (await getCustomersWithDebt()).find((c: any) => c.id === customerId);
  return row ? row.totalDebt : 0;
}

test('createSale books the sale, the money and the stock, and answers with {id, number}', async () => {
  const body = saleBody();
  const res = await sell(body);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const order = await orderOf(body.reference);
  assert.deepEqual(res.body, { id: order.id, number: String(order.number) });
  assert.equal(order.status, 'COMPLETED');
  assert.equal(order.paymentStatus, 'PAID');
  assert.equal(Number(order.totalAmount), 18_950_000);
  assert.equal(Number(order.discount), 0);
  assert.equal(Number(order.paidAmount), 18_950_000);
  assert.deepEqual(order.tags, ['website']);
  assert.equal(order.createdAt.toISOString(), '2026-09-10T18:42:11.000Z');
  assert.deepEqual(
    order.items.map((i: any) => [i.productId, i.quantity, Number(i.price), i.warehouseId]),
    [[world.raw.id, 1, 18_500_000, world.mashahir.id]],
  );

  assert.equal(order.transaction?.type, 'INCOME');
  assert.equal(order.transaction?.category, 'Sales');
  assert.equal(order.transaction?.accountId, world.account.id);
  assert.equal(Number(order.transaction?.amount), 18_950_000);
  assert.equal(order.transaction?.date.toISOString(), '2026-09-10T18:42:11.000Z');
  assert.equal(await balance(), OPENING + 18_950_000);
  await assertBooksBalance();

  assert.equal(await qty(world.raw.id, world.mashahir.id), 0);
  const movements = await prisma.inventoryMovement.findMany({ where: { referenceId: order.id } });
  assert.deepEqual(
    movements.map((m: any) => [m.type, m.productId, m.fromWarehouseId, m.quantity]),
    [['SALE', world.raw.id, world.mashahir.id, 1]],
  );

  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: order.customerId as string } });
  assert.equal(customer.phone, '09123456789');
  assert.equal(customer.name, 'سارا');
  assert.equal(customer.source, 'website');
  assert.equal(customer.siteId, 'site-user-1');
  assert.equal(customer.address, 'تهران، تهران، خیابان ولیعصر، کد پستی 1234567890');
  assert.equal(order.transaction?.customerId, customer.id);

  const data = readSiteOrderData(order.siteData);
  assert.equal(data?.payment.trackId, 'T1');
  assert.equal(data?.shipping?.carrier, 'تیپاکس');
  assert.equal(data?.shipTo?.postal, '1234567890');
  assert.deepEqual(data?.review, []);

  // The site's stock feed sees the sale.
  const stock = await (
    await GET(
      new NextRequest(`http://localhost/api/erp?action=stock&warehouseId=${world.mashahir.id}`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    )
  ).json();
  assert.equal(stock.items.find((row: any) => row.webId === 'MOAK-DAMN-RAW-WHITE').quantity, 0);
});

test('the same reference makes one sale with one number, even when sent twice at once', async () => {
  const body = saleBody();
  const first = await sell(body);
  assert.equal(first.status, 200);
  const resyncRows = () => prisma.siteHookLog.count({ where: { kind: 'resync' } });
  assert.equal(await resyncRows(), 0, 'a first sale queues no resend');
  assert.deepEqual(await sell(body), first);
  // The site may not have had the first answer, so the frame is queued to be sent again.
  assert.equal(await resyncRows(), 1);

  const racing = saleBody({
    items: [{ webId: 'MOAK-PANJ-BLUE', quantity: 1, unitPrice: 15_700_000 }],
    subtotal: 15_700_000,
    total: 16_150_000,
    payment: { amount: 16_150_000 },
  });
  const [a, b] = await Promise.all([sell(racing), sell(racing)]);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.deepEqual(a, b);

  assert.equal(await prisma.order.count(), 2);
  assert.equal(await prisma.transaction.count({ where: { type: 'INCOME' } }), 2);
  assert.equal(await qty(world.panj.id, world.mashahir.id), 4);
  // A retry of a committed sale gets the same answer even if the body no longer validates.
  assert.deepEqual(await sell({ reference: body.reference, items: [] }), first);
  await assertBooksBalance();
});

test('createSale deducts from the requested warehouse, not another', async () => {
  const res = await sell(
    saleBody({
      warehouseId: world.central.id,
      items: [{ webId: 'MOAK-PANJ-BLUE', quantity: 2, unitPrice: 15_700_000 }],
      subtotal: 31_400_000,
      total: 31_850_000,
      payment: { amount: 31_850_000 },
    }),
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(await qty(world.panj.id, world.central.id), 98);
  assert.equal(await qty(world.panj.id, world.mashahir.id), 5);
});

test('an unknown webId still records the sale, on the placeholder, flagged for review', async () => {
  const body = saleBody({
    items: [
      { webId: 'MOAK-NOPE', erpId: 'MOAK-NOPE', name: 'Mystery frame', quantity: 1, unitPrice: 1_000_000 },
      { webId: null, erpId: 'MOAK-PANJ-BLUE', quantity: 1, unitPrice: 15_700_000 },
    ],
    subtotal: 16_700_000,
    total: 17_150_000,
    payment: { amount: 17_150_000 },
  });
  assert.equal((await sell(body)).status, 200);

  const order = await orderOf(body.reference);
  const placeholder = await prisma.product.findUniqueOrThrow({ where: { sku: SITE_UNKNOWN_SKU } });
  assert.equal(placeholder.webId, null);
  assert.equal(placeholder.productType, 'OTHER');
  assert.deepEqual(order.items.map((i: any) => i.productId).sort(), [placeholder.id, world.panj.id].sort());
  assert.ok(order.tags.includes(TAG_NEEDS_REVIEW));
  assert.ok(!order.tags.includes(TAG_STOCK_SHORTAGE), 'the placeholder going negative is not a shortage');
  const data = readSiteOrderData(order.siteData);
  assert.deepEqual(data?.unknownLines.map((line) => line.webId), ['MOAK-NOPE']);
  assert.ok(data?.review.some((reason) => reason.includes('MOAK-NOPE')));
  assert.equal(await qty(placeholder.id, world.mashahir.id), -1);
  assert.equal(await qty(world.panj.id, world.mashahir.id), 4);

  // Even if someone gives the placeholder a webId, real sales never land on it silently.
  await prisma.product.update({ where: { id: placeholder.id }, data: { webId: 'MOAK-TRAP' } });
  const trap = saleBody({
    items: [{ webId: 'MOAK-TRAP', quantity: 1, unitPrice: 1 }],
    subtotal: 1,
    total: 450_001,
    payment: { amount: 450_001 },
  });
  assert.equal((await sell(trap)).status, 200);
  assert.ok((await orderOf(trap.reference)).tags.includes(TAG_NEEDS_REVIEW));

  // A line that comes with no webId and no erpId at all is unknown too: still a sale, on the placeholder, flagged.
  const nameless = saleBody({
    items: [{ webId: null, erpId: null, sku: null, productId: 'site-product-9', name: 'Frame without an id', quantity: 1, unitPrice: 18_500_000, lineTotal: 18_500_000 }],
  });
  const namelessSale = await sell(nameless);
  assert.equal(namelessSale.status, 200, JSON.stringify(namelessSale.body));
  const namelessOrder = await orderOf(nameless.reference);
  assert.deepEqual(namelessSale.body, { id: namelessOrder.id, number: String(namelessOrder.number) });
  assert.deepEqual(namelessOrder.items.map((i: any) => [i.productId, i.quantity, Number(i.price)]), [[placeholder.id, 1, 18_500_000]]);
  assert.ok(namelessOrder.tags.includes(TAG_NEEDS_REVIEW));
  const namelessData = readSiteOrderData(namelessOrder.siteData);
  assert.deepEqual(namelessData?.unknownLines.map((line) => [line.webId, line.name]), [[null, 'Frame without an id']]);
  assert.ok(namelessData?.review.some((reason) => reason.includes('Frame without an id')));
  await assertBooksBalance();
});

test('a sale larger than the stock still records, goes negative and is tagged', async () => {
  const fresh = await prisma.product.create({
    data: { name: 'NEW', sku: 'NEW', webId: 'MOAK-NEW', costPrice: 1, sellPrice: 1 },
  });
  const body = saleBody({
    items: [
      { webId: 'MOAK-DAMN-RAW-WHITE', quantity: 3, unitPrice: 18_500_000 },
      { webId: 'MOAK-NEW', quantity: 1, unitPrice: 1_000 },
    ],
    subtotal: 55_501_000,
    total: 55_951_000,
    payment: { amount: 55_951_000 },
  });
  assert.equal((await sell(body)).status, 200);
  assert.equal(await qty(world.raw.id, world.mashahir.id), -2);
  assert.equal(await qty(fresh.id, world.mashahir.id), -1, 'a product with no stock row gets a negative one');
  const order = await orderOf(body.reference);
  assert.ok(order.tags.includes(TAG_STOCK_SHORTAGE));
  assert.ok(!order.tags.includes(TAG_NEEDS_REVIEW));
});

test('one mobile is one customer: +98, spaces and Persian digits match, and empty fields never erase', async () => {
  const showroom = await prisma.customer.create({
    data: { name: 'Sara (showroom)', phone: '+98 912 345-6789', email: 'sara@example.com' },
  });
  await sell(saleBody({ customer: { name: 'سارا', mobile: '09123456789', email: null, siteId: null } }));
  await sell(saleBody({ customer: { name: null, mobile: '+989123456789', email: '', siteId: 'site-7' } }));
  await sell(saleBody({ customer: { mobile: '۰۹۱۲۳۴۵۶۷۸۹' } }));

  const customers = await prisma.customer.findMany();
  assert.equal(customers.length, 1);
  const sara = customers[0];
  assert.equal(sara.id, showroom.id);
  assert.equal(sara.email, 'sara@example.com');
  assert.equal(sara.name, 'سارا');
  assert.equal(sara.siteId, 'site-7');
  assert.equal(sara.source, null, 'an existing customer keeps their channel');
  assert.equal(sara.phone, '+98 912 345-6789', 'what staff typed is left alone');

  // An email a website order brings sits; a later order without email, name or address erases none of them.
  const withEmail = await sell(saleBody({ customer: { name: 'سارا', mobile: '09123456789', email: 'sara.new@example.com' } }));
  assert.equal(withEmail.status, 200, JSON.stringify(withEmail.body));
  assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: sara.id } })).email, 'sara.new@example.com');
  for (const shipTo of [null, { province: '', city: ' ', address: null, postal: null, note: null }]) {
    const res = await sell(saleBody({ customer: { name: null, mobile: '09123456789', email: null, siteId: null }, shipTo }));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const kept = await prisma.customer.findUniqueOrThrow({ where: { id: sara.id } });
    assert.deepEqual(
      [kept.name, kept.email, kept.address, kept.siteId],
      ['سارا', 'sara.new@example.com', 'تهران، تهران، خیابان ولیعصر، کد پستی 1234567890', 'site-7'],
      `shipTo ${JSON.stringify(shipTo)}`,
    );
  }

  // Two first orders from one new number, at the same moment, make one customer.
  await Promise.all([
    sell(saleBody({ customer: { mobile: '09350000001' } })),
    sell(saleBody({ customer: { mobile: '0935 000 0001' } })),
  ]);
  assert.equal(await prisma.customer.count({ where: { phone: '09350000001' } }), 1);
  assert.equal(await prisma.customer.count(), 2);

  // Paid sales already queue on the account row, so the race above never overlaps.
  // Free orders (a full coupon) take no account lock: only the mobile keeps them apart.
  const free = (mobile: string) => saleBody({ customer: { mobile }, payment: { amount: 0 } });
  let racing = null as Promise<{ status: number; body: any }> | null;
  beforeQuery.fn = async (params) => {
    if (!racing && params.model === 'Customer' && params.action === 'create') {
      racing = sell(free('0935 000 0002'));
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  };
  try {
    const first = await sell(free('09350000002'));
    assert.equal(first.status, 200, JSON.stringify(first.body));
  } finally {
    beforeQuery.fn = null;
  }
  assert.ok(racing, 'the hook fired inside the first sale');
  const second = await racing;
  assert.equal(second?.status, 200, JSON.stringify(second?.body));
  assert.equal(await prisma.customer.count({ where: { phone: '09350000002' } }), 1);

  assert.equal(normalizeMobile('0098 912 345 6789'), '09123456789');
  assert.equal(normalizeMobile('912-345-6789'), '09123456789');
  assert.equal(normalizeMobile('+98 0912 345 6789'), '09123456789');
  assert.equal(normalizeMobile('0098 0912 345 6789'), '09123456789');

  // A stored number typed as +98 0935… is the same person too.
  const typedWithZero = await prisma.customer.create({ data: { name: 'Typed with a zero', phone: '+98 0935 555 1234' } });
  const zeroSale = saleBody({ customer: { mobile: '09355551234' } });
  await sell(zeroSale);
  assert.equal((await orderOf(zeroSale.reference)).customerId, typedWithZero.id);
});

test("a consignment partner's number gets its own website customer", async () => {
  const partner = await prisma.customer.create({
    data: { name: 'Partner shop', phone: '09120000000', commissionRate: 10 },
  });
  await prisma.warehouse.create({ data: { name: 'امانی', isVirtual: true, customerId: partner.id } });
  const body = saleBody({ customer: { name: 'Buyer', mobile: '09120000000' } });
  assert.equal((await sell(body)).status, 200);

  const order = await orderOf(body.reference);
  assert.notEqual(order.customerId, partner.id);
  assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: partner.id } })).name, 'Partner shop');
  assert.equal(await prisma.consignmentCommission.count(), 0);
});

test('discounts, free freight and underpayment: debt is exactly what is owed', async () => {
  const discounted = saleBody({
    items: [{ webId: 'MOAK-PANJ-BLUE', quantity: 1, unitPrice: 20_000_000 }],
    subtotal: 20_000_000,
    discount: 1_500_000,
    shipping: { carrier: 'پیک موتوری', freight: 450_000, free: true },
    total: 18_500_000,
    payment: { amount: 18_500_000 },
  });
  assert.equal((await sell(discounted)).status, 200);
  const order = await orderOf(discounted.reference);
  assert.equal(Number(order.totalAmount), 20_000_000);
  assert.equal(Number(order.discount), 1_500_000);
  assert.equal(order.paymentStatus, 'PAID');
  assert.ok(!order.tags.includes(TAG_NEEDS_REVIEW), JSON.stringify(readSiteOrderData(order.siteData)?.review));
  assert.equal(await debtOf(order.customerId as string), 0);

  const short = saleBody({ customer: { mobile: '09351111111' }, payment: { amount: 18_000_000 } });
  assert.equal((await sell(short)).status, 200);
  const underpaid = await orderOf(short.reference);
  assert.equal(underpaid.paymentStatus, 'PARTIAL');
  assert.ok(underpaid.tags.includes(TAG_NEEDS_REVIEW));
  assert.equal(await debtOf(underpaid.customerId as string), 950_000);
  await assertBooksBalance();
});

test('a malformed body is 422 with a reason, null optional fields are fine, and unknown actions are 404', async () => {
  const consignment = await prisma.warehouse.create({ data: { name: 'امانی', isVirtual: true } });
  const cases: Array<[string, Record<string, unknown>]> = [
    ['no reference', saleBody({ reference: null })],
    ['bad date', saleBody({ issuedAt: 'yesterday' })],
    ['dollars', saleBody({ currency: 'usd' })],
    ['no items', saleBody({ items: [] })],
    ['zero quantity', saleBody({ items: [{ webId: 'MOAK-PANJ-BLUE', quantity: 0, unitPrice: 1 }] })],
    ['price as text', saleBody({ items: [{ webId: 'MOAK-PANJ-BLUE', quantity: 1, unitPrice: '1000' }] })],
    ['no mobile', saleBody({ customer: { name: 'x' } })],
    ['no payment', saleBody({ payment: null })],
    // Numbers the ERP cannot store are a malformed body too: a 500 would make the site retry it forever.
    ['quantity beyond an Int', saleBody({ items: [{ webId: 'MOAK-PANJ-BLUE', quantity: 3_000_000_000, unitPrice: 1 }] })],
    ['quantities that add up beyond the limit', saleBody({ items: [{ webId: 'MOAK-PANJ-BLUE', quantity: 600_000, unitPrice: 1 }, { webId: 'MOAK-PANJ-BLUE', quantity: 600_000, unitPrice: 1 }] })],
    ['total beyond a Decimal', saleBody({ total: 1e40 })],
    ['price beyond a Decimal', saleBody({ items: [{ webId: 'MOAK-PANJ-BLUE', quantity: 1, unitPrice: 1e40 }] })],
    ['payment beyond a Decimal', saleBody({ payment: { amount: 1e40, paidAt: null } })],
    ['freight beyond a Decimal', saleBody({ shipping: { freight: 1e40 } })],
  ];
  for (const [label, body] of cases) {
    const res = await sell(body);
    assert.equal(res.status, 422, label);
    assert.equal(typeof res.body.error, 'string', label);
  }
  assert.equal(await prisma.order.count(), 0);

  // A bad warehouse doesn't lose a paid sale: it comes out of the site's warehouse, flagged.
  for (const warehouseId of ['nope', consignment.id]) {
    const misdirected = saleBody({ warehouseId });
    assert.equal((await sell(misdirected)).status, 200);
    const order = await orderOf(misdirected.reference);
    assert.equal(order.items[0].warehouseId, world.mashahir.id);
    assert.ok(order.tags.includes(TAG_NEEDS_REVIEW));
  }

  const nulls = saleBody({
    discount: null,
    coupon: null,
    shipping: null,
    shipTo: null,
    subtotal: null,
    customer: { name: null, mobile: '09123456789', email: null, siteId: null, ordersBefore: null },
    payment: { amount: 18_950_000, paidAt: null, gateway: null, trackId: null, refNumber: null },
  });
  const accepted = await sell(nulls);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));

  // An archived warehouse doesn't lose a paid sale: it is taken and flagged.
  const archived = await prisma.warehouse.create({ data: { name: 'قدیمی', isArchived: true } });
  const late = saleBody({ warehouseId: archived.id });
  assert.equal((await sell(late)).status, 200);
  assert.ok((await orderOf(late.reference)).tags.includes(TAG_NEEDS_REVIEW));

  const badStatuses: Array<[string, Record<string, unknown>]> = [
    ['unknown status', { status: 'lost' }],
    ['refund without amount', { status: 'refunded', refundId: 'r1' }],
    ['refund without refundId', { status: 'refunded', amount: 1 }],
    ['restock as text', { status: 'returned', restock: 'yes' }],
    ['bad at', { status: 'shipped', at: 'soon' }],
    ['refund beyond a Decimal', { status: 'refunded', refundId: 'r-big', amount: 1e40 }],
  ];
  for (const [label, body] of badStatuses) {
    const res = await status({ reference: nulls.reference, ...body });
    assert.equal(res.status, 422, label);
  }
  assert.equal((await status({ status: 'shipped', reference: 'M-NEVER' })).status, 422, 'a sale the ERP never recorded');
  assert.equal((await status({ status: 'shipped' })).status, 422, 'no reference and no saleId');
  assert.equal((await call('nope', {})).status, 404);
});

test('a createSale that names its action only in the address records the sale like any other', async () => {
  const body = saleBody();
  const res = await POST(
    new NextRequest('http://localhost/api/erp?action=createSale', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  assert.equal(res.status, 200);
  const order = await orderOf(body.reference);
  assert.deepEqual(await res.json(), { id: order.id, number: String(order.number) });
  assert.equal(await prisma.order.count(), 1);
});
test('shipped and delivered only add to the history', async () => {
  const body = saleBody();
  await sell(body);
  const other = saleBody({ customer: { mobile: '09353333333' } });
  await sell(other);
  const before = await orderOf(body.reference);
  const otherOrder = await orderOf(other.reference);

  const shipped = await status({
    status: 'shipped',
    reference: body.reference,
    saleId: before.id,
    at: '2026-09-11T08:00:00.000Z',
    trackingCode: 'TPX-1',
  });
  assert.equal(shipped.status, 200, JSON.stringify(shipped.body));
  assert.deepEqual(shipped.body, { ok: true });
  // A retry of the same event is not a second history row.
  await status({ status: 'shipped', reference: body.reference, saleId: before.id, at: '2026-09-11T08:00:00.000Z', trackingCode: 'TPX-1' });
  // Contract examples send null for what the site doesn't have.
  assert.equal((await status({ status: 'delivered', saleId: before.id, trackingCode: null, amount: null, restock: null })).status, 200);
  assert.equal((await status({ status: 'shipped', reference: body.reference, saleId: otherOrder.id })).status, 422);

  const after = await orderOf(body.reference);
  assert.equal(after.status, 'COMPLETED');
  assert.equal(Number(after.paidAmount), Number(before.paidAmount));
  assert.equal(Number(after.totalAmount), Number(before.totalAmount));
  const history = readSiteOrderData(after.siteData)?.history ?? [];
  assert.deepEqual(history.map((event) => [event.status, event.trackingCode]), [['shipped', 'TPX-1'], ['delivered', null]]);
  assert.equal(history[0].at, '2026-09-11T08:00:00.000Z');
  assert.equal(await prisma.transaction.count({ where: { type: 'EXPENSE' } }), 0);
  await assertBooksBalance();
});

test('goods go back only with restock:true, once, into the warehouse they left', async () => {
  const body = saleBody({
    warehouseId: world.central.id,
    items: [{ webId: 'MOAK-PANJ-BLUE', quantity: 2, unitPrice: 15_700_000 }],
    subtotal: 31_400_000,
    total: 31_850_000,
    payment: { amount: 31_850_000 },
  });
  await sell(body);
  assert.equal(await qty(world.panj.id, world.central.id), 98);

  await status({ status: 'returned', reference: body.reference });
  assert.equal(await qty(world.panj.id, world.central.id), 98, 'no restock without restock:true');
  // A damaged return: the site says restock:false, and the goods stay out.
  await status({ status: 'returned', reference: body.reference, restock: false });
  assert.equal(await qty(world.panj.id, world.central.id), 98, 'no restock with restock:false');

  const [a, b] = await Promise.all([
    status({ status: 'returned', reference: body.reference, restock: true }),
    status({ status: 'returned', reference: body.reference, restock: true }),
  ]);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(b.status, 200, JSON.stringify(b.body));
  await status({ status: 'refunded', reference: body.reference, amount: 31_850_000, refundId: 'r1', restock: true });

  assert.equal(await qty(world.panj.id, world.central.id), 100);
  assert.equal(await qty(world.panj.id, world.mashahir.id), 5);
  const order = await orderOf(body.reference);
  const returns = await prisma.inventoryMovement.findMany({ where: { referenceId: order.id, type: 'RETURN' } });
  assert.deepEqual(returns.map((m: any) => [m.productId, m.toWarehouseId, m.quantity]), [[world.panj.id, world.central.id, 2]]);
  assert.equal(order.status, 'CANCELLED');
  assert.ok(!order.tags.includes(TAG_NEEDS_REVIEW));
  await assertBooksBalance();
});

test('each refund is booked once, never beyond what was paid, and a full refund cancels the sale', async () => {
  const body = saleBody();
  await sell(body);
  const reference = body.reference;

  const first = await status({
    status: 'refunded',
    reference,
    amount: 5_000_000,
    refundId: 'r1',
    at: '2026-09-12T10:00:00.000Z',
  });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal((await status({ status: 'refunded', reference, amount: 5_000_000, refundId: 'r1' })).status, 200);
  await Promise.all([
    status({ status: 'refunded', reference, amount: 1_000_000, refundId: 'r2', refundedTotal: 6_000_000, at: '2026-09-12T11:00:00.000Z' }),
    status({ status: 'refunded', reference, amount: 1_000_000, refundId: 'r2', refundedTotal: 6_000_000, at: '2026-09-12T11:00:00.000Z' }),
  ]);

  let order = await orderOf(reference);
  assert.equal(order.status, 'COMPLETED');
  assert.equal(Number(order.paidAmount), 12_950_000);
  assert.equal(Number(order.totalAmount), 12_950_000);
  assert.equal(order.paymentStatus, 'PAID');
  assert.ok(!order.tags.includes(TAG_NEEDS_REVIEW), JSON.stringify(readSiteOrderData(order.siteData)?.review));
  const refunds = await prisma.transaction.findMany({ where: { type: 'EXPENSE' }, orderBy: { date: 'asc' } });
  assert.deepEqual(
    refunds.map((t: any) => [t.category, Number(t.amount), t.accountId, t.date.toISOString()]),
    [
      ['Return', 5_000_000, world.account.id, '2026-09-12T10:00:00.000Z'],
      ['Return', 1_000_000, world.account.id, '2026-09-12T11:00:00.000Z'],
    ],
  );
  assert.equal(await balance(), OPENING + 18_950_000 - 6_000_000);

  // More than what is left: capped, flagged, and the sale is void.
  await status({ status: 'refunded', reference, amount: 20_000_000, refundId: 'r3', at: '2026-09-12T12:00:00.000Z' });
  order = await orderOf(reference);
  assert.equal(order.status, 'CANCELLED');
  assert.equal(Number(order.paidAmount), 0);
  assert.equal(Number(order.totalAmount), 0);
  assert.ok(order.tags.includes(TAG_NEEDS_REVIEW));
  assert.ok(order.items.every((item: any) => item.status === 'CANCELLED'));
  assert.deepEqual(
    order.siteRefunds.map((r: any) => [r.refundId, Number(r.amount)]).sort(),
    [['r1', 5_000_000], ['r2', 1_000_000], ['r3', 12_950_000]],
  );
  assert.equal(await balance(), OPENING);
  assert.equal(await debtOf(order.customerId as string), 0);
  await assertBooksBalance();

  // A booked refund's transaction can't be deleted out from under its record.
  await assert.rejects(prisma.transaction.delete({ where: { id: refunds[0].id } }));

  // The same refundId again with another amount is ignored, and a person is told.
  await status({ status: 'refunded', reference, amount: 1, refundId: 'r1' });
  assert.equal(await prisma.transaction.count({ where: { type: 'EXPENSE' } }), 3);
  assert.ok(readSiteOrderData((await orderOf(reference)).siteData)?.review.some((reason) => reason.includes('r1')));
});

test('cancelled refunds what it carries, is flagged when paid money or goods stay, and a coupon order can still restock', async () => {
  // A cancel may come without a refundId; sent twice, it still refunds once.
  const paidSale = saleBody();
  await sell(paidSale);
  for (let i = 0; i < 2; i++) {
    const res = await status({ status: 'cancelled', reference: paidSale.reference, amount: 18_950_000, restock: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }
  let order = await orderOf(paidSale.reference);
  assert.equal(order.status, 'CANCELLED');
  assert.equal(order.siteRefunds.length, 1);
  assert.equal(await balance(), OPENING);
  assert.equal(await qty(world.raw.id, world.mashahir.id), 1);
  assert.ok(!order.tags.includes(TAG_NEEDS_REVIEW), JSON.stringify(readSiteOrderData(order.siteData)?.review));

  const kept = saleBody({ customer: { mobile: '09352222222' } });
  await sell(kept);
  await status({ status: 'cancelled', reference: kept.reference });
  order = await orderOf(kept.reference);
  assert.equal(order.status, 'CANCELLED');
  assert.ok(order.tags.includes(TAG_NEEDS_REVIEW), 'money kept on a cancelled sale needs a person');
  assert.ok(
    readSiteOrderData(order.siteData)?.review.some((reason) => reason.includes('پیش از ارسال')),
    'goods of an unshipped cancelled sale that did not come back need a person',
  );
  assert.equal(Number(order.totalAmount) - Number(order.discount) - Number(order.paidAmount), 0);
  await status({ status: 'refunded', reference: kept.reference, amount: 18_950_000, refundId: 'k1' });
  order = await orderOf(kept.reference);
  assert.equal(order.status, 'CANCELLED');
  assert.equal(Number(order.paidAmount), 0);

  const coupon = saleBody({
    customer: { mobile: '09354444444' },
    items: [{ webId: 'MOAK-PANJ-BLUE', quantity: 1, unitPrice: 15_700_000 }],
    subtotal: 15_700_000,
    discount: 15_700_000,
    shipping: null,
    total: 0,
    payment: { amount: 0 },
  });
  assert.equal((await sell(coupon)).status, 200);
  assert.equal(await qty(world.panj.id, world.mashahir.id), 4);
  await status({ status: 'cancelled', reference: coupon.reference });
  await status({ status: 'returned', reference: coupon.reference, restock: true });
  assert.equal(await qty(world.panj.id, world.mashahir.id), 5);
  await assertBooksBalance();
});

test('restock and a partial refund sent as separate events, in either order, are flagged for review', async () => {
  const twoFrames = (mobile: string) =>
    saleBody({
      customer: { mobile },
      items: [{ webId: 'MOAK-PANJ-BLUE', quantity: 2, unitPrice: 15_700_000 }],
      subtotal: 31_400_000,
      total: 31_850_000,
      payment: { amount: 31_850_000 },
    });

  const returnedFirst = twoFrames('09356666661');
  await sell(returnedFirst);
  await status({ status: 'returned', reference: returnedFirst.reference, restock: true });
  assert.ok(!(await orderOf(returnedFirst.reference)).tags.includes(TAG_NEEDS_REVIEW));
  await status({ status: 'refunded', reference: returnedFirst.reference, amount: 15_700_000, refundId: 'half', restock: true });
  assert.ok((await orderOf(returnedFirst.reference)).tags.includes(TAG_NEEDS_REVIEW));

  const refundedFirst = twoFrames('09356666662');
  await sell(refundedFirst);
  await status({ status: 'refunded', reference: refundedFirst.reference, amount: 15_700_000, refundId: 'half' });
  assert.ok(!(await orderOf(refundedFirst.reference)).tags.includes(TAG_NEEDS_REVIEW));
  await status({ status: 'returned', reference: refundedFirst.reference, restock: true });
  assert.ok((await orderOf(refundedFirst.reference)).tags.includes(TAG_NEEDS_REVIEW));

  assert.equal(await qty(world.panj.id, world.mashahir.id), 5);
  await assertBooksBalance();
});

test('a status that arrives while its sale is still being recorded waits for it', async () => {
  const body = saleBody();
  let pending = null as Promise<{ status: number; body: any }> | null;
  beforeQuery.fn = async (params) => {
    if (!pending && params.model === 'Inventory' && params.action === 'upsert') {
      pending = status({ status: 'refunded', reference: body.reference, amount: 18_950_000, refundId: 'early' });
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  };
  try {
    const sold = await sell(body);
    assert.equal(sold.status, 200, JSON.stringify(sold.body));
  } finally {
    beforeQuery.fn = null;
  }
  assert.ok(pending, 'the hook fired inside createSale');
  const early = await pending;
  assert.equal(early?.status, 200, JSON.stringify(early?.body));
  const order = await orderOf(body.reference);
  assert.equal(order.status, 'CANCELLED');
  assert.equal(order.siteRefunds.length, 1);
  await assertBooksBalance();
});

test('an issued invoice follows website refunds and is cancelled with the sale', async () => {
  const body = saleBody();
  await sell(body);
  const sold = await orderOf(body.reference);
  await prisma.invoice.create({
    data: {
      invoiceNumber: 'INV-TEST-1',
      orderId: sold.id,
      customerId: sold.customerId as string,
      dueDate: new Date('2030-01-01T00:00:00.000Z'),
      subtotal: 18_950_000,
      total: 18_950_000,
      paidAmount: 18_950_000,
      status: 'PAID',
    },
  });

  await status({ status: 'refunded', reference: body.reference, amount: 5_000_000, refundId: 'r1' });
  let invoice = await prisma.invoice.findUniqueOrThrow({ where: { orderId: sold.id } });
  assert.deepEqual(
    [Number(invoice.subtotal), Number(invoice.total), Number(invoice.paidAmount), invoice.status],
    [13_950_000, 13_950_000, 13_950_000, 'PAID'],
  );

  await status({ status: 'refunded', reference: body.reference, amount: 13_950_000, refundId: 'r2' });
  invoice = await prisma.invoice.findUniqueOrThrow({ where: { orderId: sold.id } });
  assert.equal(invoice.status, 'CANCELLED');
  assert.equal((await orderOf(body.reference)).status, 'CANCELLED');
  await assertBooksBalance();
});
