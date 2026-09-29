import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { createConsignmentPartner, getConsignmentPartnerById, getConsignmentPartners, recordConsignmentSales } from '@/actions/consignment';
import { getConsignmentReport } from '@/actions/consignment-reports';
import { ConsignmentReport } from '@/components/consignment/consignment-report';
import { CHANNELS_FIELD } from '@/lib/consignment-channels';
import { stockIn } from '../sales/world';

// The consignment report put a <div> inside CardDescription, a <p>: a browser moves it out of the paragraph,
// React finds a different tree than the server sent, and the page fails hydration (found by the page crawl).

(globalThis as any).React = React;
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
  await prisma.user.create({ data: { id: 'test-user', name: 'Owner', email: 'owner@x.test', password: 'x', role: 'ADMIN' } });
});
after(() => prisma.$disconnect());

/** Block elements a <p> may not contain, found inside one in the rendered HTML. */
function blocksInParagraphs(html: string): string[] {
  return [...html.matchAll(/<p\b[^>]*>((?:(?!<\/p>)[\s\S])*?)<\/p>/g)]
    .filter((m) => /<(div|p|table|ul|ol|h[1-6])\b/.test(m[1]))
    .map((m) => m[0].slice(0, 160));
}

test('the consignment report renders a partner card with valid HTML: no block inside a paragraph', async () => {
  const created = await createConsignmentPartner(
    undefined,
    form({ name: 'محو', [CHANNELS_FIELD]: JSON.stringify([{ name: 'حضوری', commissionRate: 25, isDefault: true, isActive: true }]) }),
  );
  assert.equal(created.message, 'همکار امانی با موفقیت ایجاد شد.');
  const partner = await prisma.warehouse.findFirstOrThrow({ where: { isVirtual: true } });
  const frame = await prisma.product.create({ data: { name: 'PANJ', sku: 'PANJ', costPrice: 400_000, sellPrice: 1_000_000 } });
  await stockIn(frame.id, partner.id, 3);
  assert.equal((await recordConsignmentSales({ partnerWarehouseId: partner.id, saleDate: '2026-09-20', items: [{ productId: frame.id, quantity: 1, unitPrice: 1_000_000 }] })).success, true);

  const html = renderToString(React.createElement(ConsignmentReport, { reportData: (await getConsignmentReport()) as any }));
  assert.ok(html.includes('محو'));
  assert.ok(html.includes('تعداد سفارشات'));
  assert.deepEqual(blocksInParagraphs(html), []);
});

/** Paths to values a Server Component cannot hand to a Client Component: class instances such as Decimal. */
function notPlain(value: unknown, path = '$'): string[] {
  if (value === null || typeof value !== 'object' || value instanceof Date) return [];
  if (Array.isArray(value)) return value.flatMap((item, i) => notPlain(item, `${path}[${i}]`));
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return [`${path}: ${proto?.constructor?.name}`];
  return Object.entries(value).flatMap(([key, item]) => notPlain(item, `${path}.${key}`));
}

test('the partner screens get plain values only: the partner\'s credit limit is a number, not a Decimal', async () => {
  await createConsignmentPartner(undefined, form({ name: 'محو', [CHANNELS_FIELD]: JSON.stringify([{ name: 'حضوری', commissionRate: 25, isDefault: true, isActive: true }]) }));
  const partners = await getConsignmentPartners();
  assert.equal(partners.length, 1);
  assert.deepEqual(notPlain(partners), []);
  assert.equal(partners[0].customer!.creditLimit, 0);
  assert.deepEqual(notPlain(await getConsignmentPartnerById(partners[0].id)), []);
});
