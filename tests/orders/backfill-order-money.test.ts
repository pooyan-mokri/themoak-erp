import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma, resetDatabase } from '../helpers/db';

// prisma/sql/backfill-order-money.sql, as the build runs it after prisma db push.
const BACKFILL = readFileSync(join(process.cwd(), 'prisma/sql/backfill-order-money.sql'), 'utf8');
const runBackfill = () => prisma.$executeRawUnsafe(BACKFILL);

beforeEach(() => resetDatabase());
after(() => prisma.$disconnect());

test('the backfill links each existing money row to its order, only when the link is certain, and is idempotent', async () => {
  const account = await prisma.account.create({ data: { name: 'بانک سامان', type: 'BANK', currency: 'TOMAN', balance: 0 } });
  const sara = await prisma.customer.create({ data: { name: 'سارا' } });
  const reza = await prisma.customer.create({ data: { name: 'رضا' } });
  const product = await prisma.product.create({ data: { name: 'PANJ - Blue', sku: 'PANJ/BLUE', costPrice: 1, sellPrice: 1 } });

  const money = (description: string | null, extra: Record<string, unknown> = {}) =>
    prisma.transaction.create({
      data: { type: 'INCOME', amount: 1_000, amountInToman: 1_000, accountId: account.id, description, ...extra },
    });
  const order = (customerId: string, transactionId?: string) =>
    prisma.order.create({
      data: {
        customerId,
        totalAmount: 1_000,
        transactionId,
        items: { create: [{ productId: product.id, quantity: 1, price: 1_000 }] },
      },
      include: { items: true },
    });

  // (a) the checkout row an order points at
  const checkout = await money('سفارش فروش - مشتری: سارا', { customerId: sara.id });
  const first = await order(sara.id, checkout.id);
  const second = await order(sara.id);
  const third = await order(reza.id);
  const n1 = first.number;
  const n2 = second.number;

  // (b) rows a return, an exchange and a website refund point at
  const refund = await money(`عودت کالا - سفارش #${n1} - سارا`);
  await prisma.orderReturn.create({
    data: { orderId: first.id, orderItemId: first.items[0].id, quantity: 1, refundAmount: 1_000, accountId: account.id, transactionId: refund.id },
  });
  const difference = await money('تعویض کالا');
  const swapped = await prisma.orderItem.create({ data: { orderId: second.id, productId: product.id, quantity: 1, price: 1_000 } });
  await prisma.orderExchange.create({
    data: {
      orderId: second.id,
      originalItemId: second.items[0].id,
      exchangeItemId: swapped.id,
      quantity: 1,
      priceDifference: 1_000,
      accountId: account.id,
      transactionId: difference.id,
    },
  });
  const siteRefund = await money('بازپرداخت سفارش سایت M-TLD3KJ');
  await prisma.siteRefund.create({ data: { orderId: third.id, refundId: 'RF-1', transactionId: siteRefund.id, amount: 1_000, at: new Date() } });

  // (c) rows that name exactly one order and are linked to nothing else
  const payment = await money(`دریافت بابت سفارش #${n2} - مشتری: سارا`);
  const settlement = await money(`تسویه فروش امانی - سفارش #${n1} (پرداخت جزئی)`, { customerId: sara.id });
  const repeated = await money(`دریافت بابت سفارش #${n1} - باقی سفارش #${n1}`);

  // ...and rows that must stay unlinked
  const longerNumber = await money(`دریافت بابت سفارش #${n1}9`);
  const twoOrders = await money(`دریافت بابت سفارش #${n1} و سفارش #${n2}`);
  const otherCustomer = await money(`دریافت بابت سفارش #${n1}`, { customerId: reza.id });
  const transferLeg = await money(`[ورود] بابت سفارش #${n1}`, { transferGroupId: 'tg-1' });
  const oldTransferLeg = await money(`[خروج] بابت سفارش #${n1}`, { type: 'TRANSFER' });
  const correction = await money(`اصلاح موجودی بابت سفارش #${n1}`, { type: 'ADJUSTMENT' });
  const gift = await money(`هدیه همراه سفارش #${n1}`);
  await prisma.marketingGift.create({
    data: { productId: product.id, quantity: 1, accountId: account.id, transactionId: gift.id, costPrice: 1, totalCost: 1 },
  });
  const unrelated = await money('ناهار');
  // Money typed by hand that mentions an order moved for its own reason: a
  // cancel of the order must not delete it and put it back on the bank.
  const courier = await money(`Other - هزینه پیک سفارش #${n1}`, { type: 'EXPENSE' });
  const handDeposit = await money(`واریز مشتری بابت سفارش #${n2}`);
  // ...and a row already linked keeps its order.
  const linked = await money(`دریافت بابت سفارش #${n1}`, { orderId: third.id });

  await runBackfill();

  const orderOf = async () =>
    Object.fromEntries((await prisma.transaction.findMany()).map((row: any) => [row.id, row.orderId]));
  const linkedTo = await orderOf();
  assert.deepEqual(
    {
      checkout: linkedTo[checkout.id],
      refund: linkedTo[refund.id],
      difference: linkedTo[difference.id],
      siteRefund: linkedTo[siteRefund.id],
      payment: linkedTo[payment.id],
      settlement: linkedTo[settlement.id],
      repeated: linkedTo[repeated.id],
      longerNumber: linkedTo[longerNumber.id],
      twoOrders: linkedTo[twoOrders.id],
      otherCustomer: linkedTo[otherCustomer.id],
      transferLeg: linkedTo[transferLeg.id],
      oldTransferLeg: linkedTo[oldTransferLeg.id],
      correction: linkedTo[correction.id],
      gift: linkedTo[gift.id],
      unrelated: linkedTo[unrelated.id],
      courier: linkedTo[courier.id],
      handDeposit: linkedTo[handDeposit.id],
      linked: linkedTo[linked.id],
    },
    {
      checkout: first.id,
      refund: first.id,
      difference: second.id,
      siteRefund: third.id,
      payment: second.id,
      settlement: first.id,
      repeated: first.id,
      longerNumber: null,
      twoOrders: null,
      otherCustomer: null,
      transferLeg: null,
      oldTransferLeg: null,
      correction: null,
      gift: null,
      unrelated: null,
      courier: null,
      handDeposit: null,
      linked: third.id,
    },
  );

  // A second run (every deploy runs it) changes nothing.
  await runBackfill();
  assert.deepEqual(await orderOf(), linkedTo);
});
