import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { seedShop, PRICE } from '../orders/seed';
import { deleteReceipt, uploadReceipt } from '@/actions/upload';
import { attachReceipt } from '@/actions/receipts';
import { recordDeposit } from '@/actions/accounting';
import { createOrder, getOrder, recordOrderPayment } from '@/actions/sales';
import { paySettlement } from '@/actions/consignment';
import { GET } from '@/app/api/receipts/route';
import { INVALID_RECEIPT_MESSAGE, mayViewReceipt } from '@/lib/receipt-ref';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('a receipt photo')]);
const PDF = Buffer.from('%PDF-1.4\na bank slip\n%%EOF');
const DENIED = 'شما به این بخش دسترسی ندارید.';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(async () => {
  rmSync(join(process.cwd(), '.receipts'), { recursive: true, force: true });
  await prisma.$disconnect();
});

async function upload(bytes: Buffer, type = 'image/png'): Promise<string> {
  const data = new FormData();
  data.append('file', new File([new Uint8Array(bytes)], 'receipt', { type }));
  const result: any = await uploadReceipt(data);
  assert.equal(result.success, true, result.error);
  return result.url;
}

async function view(ref: string) {
  const response = await GET(new NextRequest(`http://localhost/api/receipts?ref=${encodeURIComponent(ref)}`));
  return { status: response.status, type: response.headers.get('content-type'), body: Buffer.from(await response.arrayBuffer()) };
}

/** A deposit of 1,000,000 to a bank, booked by an accountant, with this receipt. */
async function deposit(receiptUrl = '') {
  const bank = await prisma.account.upsert({
    where: { id: 'bank' },
    update: {},
    create: { id: 'bank', name: 'بانک', type: 'BANK', currency: 'TOMAN', balance: 0 },
  });
  setTestRole('ACCOUNTANT');
  const result = await recordDeposit(
    undefined,
    form({ amount: '1000000', currency: 'TOMAN', accountId: bank.id, description: 'واریز', receiptUrl }),
  );
  return { result, row: await prisma.transaction.findFirst({ where: { accountId: bank.id }, orderBy: { createdAt: 'desc' } }) };
}

test('a receipt is typed by its bytes, not by what the browser claims', async () => {
  setTestRole('SALES');
  assert.match(await upload(PNG), /^ftp:\/uploads\/receipts\/[0-9a-f-]{36}\.png$/);
  assert.match(await upload(PDF, 'image/png'), /\.pdf$/);

  const fake = new FormData();
  fake.append('file', new File(['<script>alert(1)</script>'], 'x.png', { type: 'image/png' }));
  assert.match((await uploadReceipt(fake)).error ?? '', /فقط عکس/);

  const huge = new FormData();
  huge.append('file', new File([Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)])], 'x.png', { type: 'image/png' }));
  assert.match((await uploadReceipt(huge)).error ?? '', /۴ مگابایت/);
});

test('a deposit, a POS sale, an order payment and a settlement each keep the receipt given with them', async () => {
  const dep = await deposit(await upload(PDF));
  assert.equal(dep.result.success, true, dep.result.message);
  assert.match(dep.row!.receiptUrl ?? '', /\.pdf$/);

  const shop = await seedShop();
  setTestRole('SALES');
  const sale = await createOrder({
    customerId: shop.customer.id,
    items: [{ productId: shop.product.id, quantity: 1, price: PRICE }],
    paymentMethod: 'ACCOUNT',
    accountId: shop.saman.id,
    totalAmount: PRICE,
    paidAmount: PRICE / 2,
    warehouseId: shop.warehouse.id,
    receiptUrl: await upload(PNG),
  });
  assert.equal(sale.success, true, sale.message);
  const order = await prisma.order.findFirstOrThrow({ include: { transaction: true } });
  assert.match(order.transaction!.receiptUrl ?? '', /\.png$/);

  const paymentReceipt = await upload(PNG);
  assert.equal((await recordOrderPayment(order.id, shop.novin.id, PRICE / 2, undefined, paymentReceipt)).success, true);
  assert.equal((await prisma.transaction.findFirstOrThrow({ where: { accountId: shop.novin.id } })).receiptUrl, paymentReceipt);

  // The order page lists both payments with their receipts.
  const received = (await getOrder(order.id))!.received;
  assert.deepEqual(received.map((row: { amountInToman: number; receiptUrl?: string }) => [row.amountInToman, !!row.receiptUrl]), [[PRICE / 2, true], [PRICE / 2, true]]);

  const partner = await prisma.customer.create({ data: { name: 'همکار', commissionRate: 10 } });
  await prisma.warehouse.create({ data: { name: 'امانی', isVirtual: true, customerId: partner.id } });
  const consigned = await prisma.order.create({
    data: {
      customerId: partner.id,
      status: 'COMPLETED',
      paymentStatus: 'UNPAID',
      totalAmount: 900_000,
      paidAmount: 0,
      items: { create: [{ productId: shop.product.id, warehouseId: shop.warehouse.id, quantity: 1, price: 1_000_000 }] },
      commissions: { create: [{ customerId: partner.id, commissionRate: 10, orderAmount: 1_000_000, commissionAmount: 100_000, isPaid: true }] },
    },
  });
  const settlementReceipt = await upload(PNG);
  const settled = await paySettlement(undefined, form({ orderId: consigned.id, accountId: shop.saman.id, receiptUrl: settlementReceipt }));
  assert.equal(settled.success, true, settled.message);
  assert.equal((await prisma.transaction.findFirstOrThrow({ where: { orderId: consigned.id, type: 'INCOME' } })).receiptUrl, settlementReceipt);
});

test('a receipt that is not an uploaded file is refused and nothing is booked', async () => {
  for (const junk of ['javascript:alert(1)', 'ftp:/uploads/receipts/x.png', 'ftp:/uploads/../../etc/00000000-0000-4000-8000-000000000000.png', '/uploads/receipts/00000000-0000-4000-8000-000000000000.png']) {
    const { result } = await deposit(junk);
    assert.equal(result.message, INVALID_RECEIPT_MESSAGE, junk);
  }
  assert.equal(await prisma.transaction.count(), 0);
  const shop = await seedShop();
  setTestRole('SALES');
  const order = await createOrder({
    customerId: shop.customer.id,
    items: [{ productId: shop.product.id, quantity: 1, price: PRICE }],
    paymentMethod: 'ACCOUNT',
    accountId: shop.saman.id,
    totalAmount: PRICE,
    warehouseId: shop.warehouse.id,
    receiptUrl: 'https://evil.example/x.png',
  });
  assert.equal(order.message, INVALID_RECEIPT_MESSAGE);
  assert.equal(await prisma.order.count(), 0);
});

test('a receipt is attached afterwards by whoever may record that money; only an admin replaces one', async () => {
  // The signed-in user of tests/stubs/auth.ts, so the activity log can name them.
  await prisma.user.create({ data: { id: 'test-user', name: 'Test', email: 'test@example.com', password: 'x' } });
  const { row } = await deposit();
  const shop = await seedShop();
  setTestRole('SALES');
  await createOrder({
    customerId: shop.customer.id,
    items: [{ productId: shop.product.id, quantity: 1, price: PRICE }],
    paymentMethod: 'ACCOUNT',
    accountId: shop.saman.id,
    totalAmount: PRICE,
    warehouseId: shop.warehouse.id,
  });
  const sale = await prisma.transaction.findFirstOrThrow({ where: { accountId: shop.saman.id, type: 'INCOME' } });

  // Sales staff: the order's money, not a bank deposit.
  const salesFile = await upload(PNG);
  assert.equal((await attachReceipt(row!.id, salesFile)).message, DENIED);
  assert.equal((await attachReceipt(sale.id, salesFile)).success, true);
  for (const role of ['WAREHOUSE', 'AUDITOR', null]) {
    setTestRole(role);
    assert.equal((await attachReceipt(row!.id, salesFile)).message, DENIED, String(role));
  }

  setTestRole('ACCOUNTANT');
  const depositFile = await upload(PDF);
  assert.equal((await attachReceipt(row!.id, depositFile)).success, true);
  // One file, one row; a second receipt replaces the first only for an admin.
  const other = (await deposit()).row!;
  assert.match((await attachReceipt(other.id, depositFile)).message ?? '', /تراکنش دیگری/);
  assert.match((await attachReceipt(row!.id, await upload(PNG))).message ?? '', /فقط مدیر/);
  assert.match((await attachReceipt(sale.id, await upload(PNG))).message ?? '', /فقط مدیر/);
  assert.equal((await attachReceipt(row!.id, 'ftp:/nope.png')).message, INVALID_RECEIPT_MESSAGE);
  assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: row!.id } })).receiptUrl, depositFile);

  setTestRole('ADMIN');
  const replacement = await upload(PNG);
  assert.equal((await attachReceipt(row!.id, replacement)).success, true);
  assert.equal((await prisma.transaction.findUniqueOrThrow({ where: { id: row!.id } })).receiptUrl, replacement);
  assert.equal(await prisma.activityLog.count({ where: { action: { in: ['ATTACH_RECEIPT', 'REPLACE_RECEIPT'] } } }), 3);
});

test('a receipt opens only for someone who may see its row', async () => {
  const depositFile = await upload(PDF);
  const { row } = await deposit(depositFile);
  assert.ok(row);
  const shop = await seedShop();
  setTestRole('SALES');
  const orderFile = await upload(PNG);
  await createOrder({
    customerId: shop.customer.id,
    items: [{ productId: shop.product.id, quantity: 1, price: PRICE }],
    paymentMethod: 'ACCOUNT',
    accountId: shop.saman.id,
    totalAmount: PRICE,
    warehouseId: shop.warehouse.id,
    receiptUrl: orderFile,
  });
  const unsaved = await upload(PNG);

  const cases: Array<[string | null, string, number]> = [
    ['ACCOUNTANT', depositFile, 200],
    ['AUDITOR', depositFile, 200],
    ['SALES', depositFile, 403],
    ['SALES', orderFile, 200],
    ['WAREHOUSE', orderFile, 403],
    ['SALES', unsaved, 200], // the uploader previews it in the form
    ['AUDITOR', unsaved, 403],
    [null, orderFile, 401],
    ['ADMIN', 'ftp:/uploads/receipts/00000000-0000-4000-8000-000000000000.png', 404],
    ['ADMIN', '../../.env', 404],
  ];
  for (const [role, ref, status] of cases) {
    setTestRole(role);
    assert.equal((await view(ref)).status, status, `${role} ${ref}`);
  }

  setTestRole('ACCOUNTANT');
  const opened = await view(depositFile);
  assert.equal(opened.type, 'application/pdf');
  assert.deepEqual(opened.body, PDF);
  assert.equal(mayViewReceipt('SALES', { type: 'EXPENSE', orderId: 'o1' }), false);
});

test('an unsaved upload can be discarded; a receipt on a row cannot', async () => {
  const saved = await upload(PNG);
  await deposit(saved);
  const unsaved = await upload(PNG);
  setTestRole('ACCOUNTANT');
  assert.match((await deleteReceipt(saved)).error ?? '', /ثبت‌شده/);
  assert.equal((await view(saved)).status, 200);
  assert.equal((await deleteReceipt(unsaved)).success, true);
  assert.equal((await view(unsaved)).status, 404);
});
