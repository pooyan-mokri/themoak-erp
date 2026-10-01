import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { createOrder } from '@/actions/sales';
import { recordDeposit, recordExpense, recordInternalTransfer, recordWithdrawal } from '@/actions/accounting';
import { recordPurchasePartialPayment } from '@/actions/supplier-workflow';
import { createMarketingGift } from '@/actions/marketing';
import { entryDateProblem, readEntryDate } from '@/lib/entry-date';
import { openAccount } from './ledger';

// A Jalali date typed where a Gregorian one belongs lands in the year 1404 AD (16 old WooCommerce orders did,
// 2026-10-01). Every date a person gives a sale, a payment or another money entry must be one that can be:
// from 1 Farvardin 1404 to a year after today (src/lib/entry-date.ts), refused in Persian otherwise.

console.error = () => {};

const IMPOSSIBLE = 'ممکن نیست؛ باید از ۱ فروردین ۱۴۰۴ تا یک سال بعد از امروز باشد.';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

test('a date is possible from 1 Farvardin 1404 (Tehran) to a year after today', () => {
  const now = new Date('2026-10-01T10:00:00Z');
  const problem = (iso: string) => entryDateProblem(new Date(iso), 'فروش', now);
  assert.equal(problem('1404-09-28T18:22:36Z'), `تاریخ فروش ${IMPOSSIBLE}`);
  assert.equal(problem('2647-07-09T00:00:00Z'), `تاریخ فروش ${IMPOSSIBLE}`);
  assert.equal(problem('2025-03-20T20:29:59Z'), `تاریخ فروش ${IMPOSSIBLE}`); // 1403/12/30 in Tehran
  assert.equal(problem('2025-03-20T20:30:00Z'), null); // 1404/01/01 00:00 in Tehran
  assert.equal(problem('2026-10-01T10:00:00Z'), null);
  assert.equal(problem('2027-09-30T10:00:00Z'), null);
  assert.equal(problem('2027-10-03T10:00:00Z'), `تاریخ فروش ${IMPOSSIBLE}`);
  assert.equal(entryDateProblem(new Date('not a date'), 'پرداخت', now), 'تاریخ پرداخت نامعتبر است.');
  const fallback = new Date('2026-09-01T00:00:00Z');
  assert.deepEqual(readEntryDate('', 'واریز', fallback), { ok: true, date: fallback });
  assert.deepEqual(readEntryDate(undefined, 'واریز', fallback), { ok: true, date: fallback });
  assert.deepEqual(readEntryDate('1404-06-02', 'واریز'), { ok: false, error: `تاریخ واریز ${IMPOSSIBLE}` });
});

test('the POS, the money forms, a supplier payment and a gift refuse a Jalali year typed as Gregorian', async () => {
  await openAccount('bank', 100_000_000);
  await openAccount('other', 0);
  await prisma.account.create({ data: { id: 'gifts', name: 'Marketing Expenses', type: 'EXPENSE', currency: 'TOMAN', balance: 0 } });
  const shop = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const product = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 100, sellPrice: 1_000_000 } });
  await prisma.inventory.create({ data: { productId: product.id, warehouseId: shop.id, quantity: 5 } });
  const supplier = await prisma.supplier.create({ data: { name: 'FINEWELL' } });
  const po = await prisma.purchaseOrder.create({
    data: { supplierId: supplier.id, status: 'PENDING_PAYMENT', totalAmount: 1_000_000, totalAmountInToman: 1_000_000 },
  });
  const jalali = '1404-06-02T08:09:29.000Z';
  const before = {
    transactions: await prisma.transaction.count(),
    orders: await prisma.order.count(),
    stock: (await prisma.inventory.findFirstOrThrow()).quantity,
  };

  const refusals = [
    await createOrder({ customerId: '', items: [{ productId: product.id, quantity: 1, price: 1_000_000 }], paymentMethod: 'CASH', accountId: 'bank', totalAmount: 1_000_000, warehouseId: shop.id, saleDate: jalali }),
    await recordExpense(undefined as any, form({ amount: '1000', currency: 'TOMAN', category: 'Rent', accountId: 'bank', date: jalali })),
    await recordDeposit(undefined as any, form({ amount: '1000', currency: 'TOMAN', accountId: 'bank', description: 'x', date: jalali })),
    await recordWithdrawal(undefined as any, form({ amount: '1000', currency: 'TOMAN', accountId: 'bank', payee: 'x', date: jalali })),
    await recordInternalTransfer(undefined as any, form({ amount: '1000', fromAccountId: 'bank', toAccountId: 'other', date: jalali })),
    await recordPurchasePartialPayment({ orderId: po.id, accountId: 'bank', amount: 1000, date: jalali }),
    await createMarketingGift(undefined as any, form({ accountId: 'gifts', recipientName: 'مهمان', items: JSON.stringify([{ productId: product.id, quantity: 1, warehouseId: shop.id }]), date: jalali })),
  ] as Array<{ success?: boolean; message?: string }>;
  const words = ['فروش', 'هزینه', 'واریز', 'پرداخت', 'انتقال', 'پرداخت', 'هدیه'];
  for (const [i, result] of refusals.entries()) {
    assert.notEqual(result.success, true, words[i]);
    assert.equal(result.message, `تاریخ ${words[i]} ${IMPOSSIBLE}`, words[i]);
  }
  assert.deepEqual(
    { transactions: await prisma.transaction.count(), orders: await prisma.order.count(), stock: (await prisma.inventory.findFirstOrThrow()).quantity },
    before,
  );
});

test('no action reads a money entry\'s date without the check', () => {
  const dir = join(process.cwd(), 'src/actions');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(join(dir, file), 'utf8');
    assert.ok(!/\b(date|saleDate|paymentDate) \? new Date\(\1\)/.test(source), `${file} parses a date without src/lib/entry-date.ts`);
    if (/new Date\((saleDate|paymentDate)\)/.test(source)) assert.ok(source.includes("from '@/lib/entry-date'"), file);
  }
});
