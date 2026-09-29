import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Customer360 } from '@/components/crm/customer-360';
import { DealKanban, stopClickAfterDrag } from '@/components/crm/deal-kanban';

/**
 * No customer data leaves the ERP through a picture: the customer file drew
 * its avatar from api.dicebear.com with the customer's name in the address.
 */

// The components use the classic JSX runtime, which Next provides and tsx does not.
(globalThis as any).React = React;

const ROOT = process.cwd();
const AVATAR_SERVICES = /dicebear|gravatar|ui-avatars|robohash|pravatar|boringavatars|avatars\.githubusercontent/i;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

test('no screen builds an outside address from data: no avatar service, no https://…${…} in a page or component', () => {
  const offenders: string[] = [];
  for (const file of files(join(ROOT, 'src'))) {
    const source = readFileSync(file, 'utf8');
    const name = relative(ROOT, file);
    if (AVATAR_SERVICES.test(source)) offenders.push(`${name}: avatar service`);
    const ui = name.startsWith('src/components/') || name.startsWith('src/app/');
    if (ui && /https?:\/\/[^`"' ]*\$\{/.test(source)) offenders.push(`${name}: outside address built from data`);
  }
  assert.deepEqual(offenders, []);
});

test('the customer file draws the avatar from the name itself, with no picture from outside', () => {
  const html = renderToStaticMarkup(
    createElement(Customer360, {
      customer: { id: 'c1', name: 'سارا احمدی', customerType: 'INDIVIDUAL', loyaltyPoints: 0, createdAt: new Date('2026-09-01') },
    }),
  );
  assert.match(html, /سا/);
  // Only the icons' own SVG namespace is an address on the page.
  assert.doesNotMatch(html.replaceAll('xmlns="http://www.w3.org/2000/svg"', ''), /<img|https?:\/\//);
});

test('a deal card is a link to its deal, and only the click that ends a drag is held back', () => {
  const html = renderToStaticMarkup(
    createElement(DealKanban, { deals: [{ id: 'deal-1', title: 'خرید سازمانی', stage: 'PROPOSAL', value: 5_000_000, probability: 50, customer: { name: 'سارا' } }] }),
  );
  assert.match(html, /href="\/dashboard\/crm\/deals\/deal-1"/);

  let prevented = 0;
  const click = { preventDefault: () => { prevented += 1; } };
  stopClickAfterDrag(click, false);
  assert.equal(prevented, 0, 'a plain click opens the deal');
  stopClickAfterDrag(click, true);
  assert.equal(prevented, 1, 'the click fired by a drop stays on the board');
});
