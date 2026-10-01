import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getBalanceSheet } from '@/actions/reports';
import { getBalanceSheet as getReportingBalanceSheet } from '@/actions/reporting';
import { closePurchaseOrderShort, receivePurchaseOrderItems } from '@/actions/supplier';
import { payPurchaseOrderFromCredit, recordArrival, recordPurchasePartialPayment, recordPurchasePayment, updatePurchaseOrderStatus } from '@/actions/supplier-workflow';
import AccountingReportsPage from '@/app/dashboard/accounting/reports/page';
import { BalanceSheetReport } from '@/components/reports/balance-sheet-report';
import { BalanceSheetCard } from '@/components/reporting/balance-sheet-card';
import { order, purchasingWorld, type World } from './world';

// Coordinator, 2026-10-01: what suppliers owe back (SupplierCredit, «طلب از تأمین‌کنندگان») is an asset line of
// the balance sheet, hidden when 0, and never counted twice with «پیش‌پرداخت خرید»: cancelling or closing short
// moves the money from prepaid to the credit, and spending the credit moves it back to the next order's prepaid.

console.error = () => {};
(globalThis as any).React = React;

let w: World;
const LABEL = 'طلب از تأمین‌کنندگان';

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
  w = await purchasingWorld();
});
after(() => prisma.$disconnect());

const ok = (result: { success?: boolean; message?: string; error?: string }) => assert.equal(result.success, true, result.error ?? result.message);
/** 10 frames at 100,000 plus 200,000 freight: 1,200,000 toman. */
const tenFrames = () =>
  order(w, [{ productId: w.panj.id, quantity: 10, unitCost: 100_000 }], [{ title: 'حمل', amount: 200_000, currency: 'TOMAN' }], 'PENDING_PAYMENT');

async function sheet() {
  const s = await getBalanceSheet(new Date());
  return { credits: s.assets.supplierCredits, prepaid: s.assets.prepaidPurchases, payables: s.liabilities.accountsPayable, total: s.assets.total, equity: s.equity.total, s };
}

/** Every balance-sheet screen shows the line exactly when it is not 0. */
async function screensShow(amount: number) {
  const { s } = await sheet();
  const card = await getReportingBalanceSheet();
  const shown = [
    renderToStaticMarkup(React.createElement(BalanceSheetReport, { data: s })),
    renderToStaticMarkup(React.createElement(BalanceSheetCard, { data: card })),
    renderToStaticMarkup(await AccountingReportsPage()),
  ].map((html) => html.includes(LABEL));
  assert.deepEqual(shown, [amount !== 0, amount !== 0, amount !== 0]);
  if (amount) {
    const fa = amount.toLocaleString('fa-IR');
    assert.ok(renderToStaticMarkup(React.createElement(BalanceSheetReport, { data: s })).includes(`>${fa}<`));
    assert.ok(renderToStaticMarkup(React.createElement(BalanceSheetCard, { data: card })).includes(`${LABEL}:</span><span>${fa}</span>`));
  }
}

test('a cancelled order\'s payments move from prepaid to the supplier\'s credit, counted once; spent, they move back', async () => {
  await screensShow(0);
  const po = await tenFrames();
  ok(await recordPurchasePartialPayment({ orderId: po.id, accountId: 'toman', amount: 800_000 }));
  const paid = await sheet();
  assert.deepEqual([paid.prepaid, paid.credits], [800_000, 0]);

  ok(await updatePurchaseOrderStatus(po.id, 'CANCELLED', 800_000));
  const cancelled = await sheet();
  assert.deepEqual([cancelled.prepaid, cancelled.credits, cancelled.total, cancelled.equity], [0, 800_000, paid.total, paid.equity]);
  await screensShow(800_000);

  // The credit pays the next order: it is that order's prepaid now, and the credit line goes.
  const next = await tenFrames();
  ok(await payPurchaseOrderFromCredit({ orderId: next.id }));
  const spent = await sheet();
  assert.deepEqual([spent.prepaid, spent.credits, spent.total, spent.equity], [800_000, 0, paid.total, paid.equity]);
  await screensShow(0);
});

test('an order closed short: the missing units\' price becomes the credit, never prepaid as well', async () => {
  const po = await tenFrames();
  ok(await recordPurchasePayment(po.id, 'toman'));
  ok(await updatePurchaseOrderStatus(po.id, 'IN_PRODUCTION'));
  ok(await recordArrival(po.id, [{ title: 'ترخیص', amount: 50_000, currency: 'TOMAN' }], 'toman'));
  ok(await receivePurchaseOrderItems(po.id, w.main.id, [{ itemId: po.items[0].id, receivedQuantity: 8 }]));
  const short = await sheet();
  // Paid 1,250,000 with the arrival cost; 8 of 10 came at 125,000 each: 250,000 paid for what did not come.
  assert.deepEqual([short.prepaid, short.credits, short.payables], [250_000, 0, 0]);

  ok(await closePurchaseOrderShort(po.id, 200_000));
  const closed = await sheet();
  // 200,000 for the 2 frames is owed back; the 50,000 of costs they carried went into the stock's cost.
  assert.deepEqual([closed.prepaid, closed.credits, closed.payables], [0, 200_000, 0]);
  assert.equal(Math.round(closed.total), Math.round(short.total));
  assert.equal(Math.round(closed.equity), Math.round(short.equity));
  await screensShow(200_000);
});
