import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { prisma, form } from '../helpers/db';
import { createOrder } from '@/actions/sales';
import { createInvoiceFromOrder } from '@/actions/invoice';
import { returnOrderItem } from '@/actions/order-return';
import { exchangeOrderItem } from '@/actions/order-exchange';
import type { OrderMoney } from '@/lib/return-math';
import PrintOrderPage from '@/app/dashboard/sales/orders/[id]/print/page';
import PrintInvoicePage from '@/app/dashboard/sales/invoices/[id]/print/page';
import InvoiceDetailsPage from '@/app/dashboard/sales/invoices/[id]/page';

/**
 * A shop, sales through the real actions, and the invoice as its three views
 * render it (the order's «چاپ فاکتور», the invoice print, the invoice page),
 * for the invoice, return and exchange tests.
 */

// The pages compile to React.createElement under the test runner.
(globalThis as any).React = React;

export const A = 1_000_000;
export const PRICIER = 1_600_000;
export const CHEAPER = 700_000;
export const SMALL = 500_000;


/** A shop: one warehouse holding 10 of each frame, a till, a customer. */
export async function shop() {
  const warehouse = await prisma.warehouse.create({ data: { name: 'مشاهیر' } });
  const make = (name: string, price: number) =>
    prisma.product.create({ data: { name, sku: name, costPrice: 1, sellPrice: price } });
  const p = { A: await make('PANJ', A), PRICIER: await make('HAFT', PRICIER), CHEAPER: await make('YEK', CHEAPER), SMALL: await make('DO', SMALL) };
  await prisma.inventory.createMany({ data: Object.values(p).map((x) => ({ productId: x.id, warehouseId: warehouse.id, quantity: 10 })) });
  const till = await prisma.account.create({ data: { name: 'صندوق', type: 'CASH', currency: 'TOMAN', balance: 0 } });
  const customer = await prisma.customer.create({ data: { name: 'سارا' } });
  return { warehouse, p, till, customer };
}
export type Shop = Awaited<ReturnType<typeof shop>>;
export type Frame = keyof Shop['p'];

/** A POS sale through createOrder, invoiced at once. */
export async function sell(s: Shop, lines: Array<[Frame, number]>, discount: number, paid: number) {
  const items = lines.map(([k, quantity]) => ({ productId: s.p[k].id, quantity, price: Number(s.p[k].sellPrice) }));
  const totalAmount = items.reduce((t, i) => t + i.price * i.quantity, 0);
  const sale: any = await createOrder({
    customerId: s.customer.id, items, paymentMethod: 'CASH', accountId: s.till.id,
    totalAmount, discount, paidAmount: paid, warehouseId: s.warehouse.id,
  });
  assert.equal(sale.success, true, sale.message);
  const order = await prisma.order.findFirstOrThrow({ orderBy: { number: 'desc' }, include: { items: true } });
  const invoice: any = await createInvoiceFromOrder(order.id);
  assert.equal(invoice.success, true, invoice.message);
  const line = (k: Frame) => order.items.find((i: any) => i.productId === s.p[k].id)!;
  return { order, invoiceId: invoice.invoiceId as string, line };
}

export async function giveBack(s: Shop, orderId: string, itemId: string, quantity: number) {
  const r = await returnOrderItem({}, form({ orderId, orderItemId: itemId, quantity: String(quantity), accountId: s.till.id, warehouseId: s.warehouse.id }));
  assert.equal(r.success, true, r.message);
}

export async function swap(s: Shop, orderId: string, itemId: string, to: Frame, quantity: number, extra: Record<string, string> = {}) {
  const r = await exchangeOrderItem({}, form({
    orderId, originalItemId: itemId, exchangeProductId: s.p[to].id, quantity: String(quantity),
    accountId: s.till.id, returnWarehouseId: s.warehouse.id, exchangeWarehouseId: s.warehouse.id, ...extra,
  }));
  assert.equal(r.success, true, r.message);
}

export const digits = (text: string) =>
  text.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٬,]/g, '').replace(/[‎‏]/g, '');
export const plain = (html: string) => digits(html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
export const lastCellNumber = (row: string) => {
  const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => plain(c[1]));
  return Number(cells[cells.length - 1].replace(/[^\d-]/g, ''));
};

/** The invoice table of a rendered page: its lines as text, and its money rows by key. */
export function readInvoice(html: string) {
  const lines = [...html.matchAll(/<tr data-line="(\w+)" data-counted="(\d)" data-amount="(-?\d+)"[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => {
    const cells = [...m[4].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => plain(c[1]));
    // What is shown is what is counted.
    assert.equal(Number(cells[4].replace(/\D/g, '')), Number(m[3]), `shown amount of ${cells[1]}`);
    return { kind: m[1], counted: m[2] === '1', amount: Number(m[3]), text: `${m[1]} ${cells[1]} ×${cells[2]} = ${m[3]}` };
  });
  const rows: Record<string, number> = {};
  for (const m of html.matchAll(/<tr data-row="(\w+)" data-amount="(-?\d+)"[^>]*>([\s\S]*?)<\/tr>/g)) {
    rows[m[1]] = Number(m[2]);
    assert.equal(Math.abs(lastCellNumber(m[3])), Number(m[2]), `shown ${m[1]}`);
  }
  return { lines, rows };
}

/** The rows add up: counted lines = جمع کالا; جمع کالا − deductions = net; net − paid = remaining or −credit. */
export function assertAddsUp(inv: ReturnType<typeof readInvoice>) {
  const r = inv.rows;
  const counted = inv.lines.filter((l) => l.counted).reduce((sum, l) => sum + l.amount, 0);
  assert.equal(counted, r.goods, 'counted lines add up to جمع کالا');
  const net = r.goods + (r.freight ?? 0) - (r.siteRefunded ?? 0) - (r.commission ?? 0) - (r.discount ?? 0);
  assert.equal(net, r.net, 'جمع کالا less deductions is the net');
  if ('credit' in r) assert.equal(r.paid - r.net, r.credit, 'paid beyond the net is بستانکار');
  else assert.equal(r.net - r.paid, r.remaining, 'net less paid is باقی‌مانده');
}

export const render = async (page: Promise<any>) => renderToStaticMarkup(await page);

/**
 * The order's «چاپ فاکتور», the invoice print and the invoice page show the
 * same lines and money rows, which add up to `expected`.
 */
export async function assertInvoice(
  orderId: string,
  invoiceId: string,
  expected: { lines: string[]; rows: Record<string, number> },
) {
  const views = {
    orderPrint: readInvoice(await render(PrintOrderPage({ params: Promise.resolve({ id: orderId }) }))),
    invoicePrint: readInvoice(await render(PrintInvoicePage({ params: Promise.resolve({ id: invoiceId }) }))),
    invoicePage: readInvoice(await render(InvoiceDetailsPage({ params: Promise.resolve({ id: invoiceId }) }))),
  };
  for (const [name, view] of Object.entries(views)) {
    assert.deepEqual(view.lines.map((l) => l.text), expected.lines, `${name} lines`);
    assert.deepEqual(view.rows, expected.rows, `${name} money rows`);
    assertAddsUp(view);
  }
  // The invoice row the lists read agrees with the printed net and paid.
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  assert.equal(Number(invoice.total), expected.rows.net, 'Invoice.total');
  assert.equal(Number(invoice.paidAmount), expected.rows.paid, 'Invoice.paidAmount');
}

export const tillBalance = async (s: Shop) => Number((await prisma.account.findUniqueOrThrow({ where: { id: s.till.id } })).balance);
export const orderRow = async (id: string) => {
  const o = await prisma.order.findUniqueOrThrow({ where: { id } });
  return { total: Number(o.totalAmount), discount: Number(o.discount), paid: Number(o.paidAmount), status: o.paymentStatus };
};
export const money = (m: Partial<OrderMoney>): OrderMoney => ({ totalAmount: 0, discount: 0, paidAmount: 0, commissionRate: 0, ...m });
