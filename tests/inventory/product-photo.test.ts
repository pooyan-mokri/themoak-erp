import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProductPhoto } from '@/components/inventory/product-photo';

// Photos linked from the old WordPress store (themoak.com/wp-content/…) answer 404. Every screen that shows a
// product photo uses ProductPhoto, which shows the screen's own neutral placeholder when there is no photo or
// it does not load (onError, or an error before the page came alive).

(globalThis as any).React = React;
const COMPONENTS = join(process.cwd(), 'src/components');

test('a product photo is a plain <img> that falls back to the placeholder; no photo shows the placeholder', () => {
  const photo = renderToStaticMarkup(
    React.createElement(ProductPhoto, { src: 'https://themoak.com/wp-content/uploads/x.jpg', alt: 'PANJ', className: 'h-9', fallback: React.createElement('i', null, 'بدون تصویر') }),
  );
  assert.match(photo, /^<img src="https:\/\/themoak\.com\/wp-content\/uploads\/x\.jpg" alt="PANJ" class="h-9"\/>$/);
  for (const src of [undefined, null, '']) {
    const none = renderToStaticMarkup(React.createElement(ProductPhoto, { src, alt: 'PANJ', fallback: React.createElement('i', null, 'بدون تصویر') }));
    assert.equal(none, '<span data-photo-fallback="true" class="contents"><i>بدون تصویر</i></span>');
  }
  const source = readFileSync(join(COMPONENTS, 'inventory/product-photo.tsx'), 'utf8');
  assert.match(source, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(source, /node\.complete && node\.naturalWidth === 0/);
});

test('every screen that shows a product photo shows it through ProductPhoto', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.tsx')) files.push(path);
    }
  };
  walk(COMPONENTS);
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const name = relative(COMPONENTS, file);
    if (name === 'inventory/product-photo.tsx') continue;
    // A raw <img> or next/image of a product's photo (image, imageUrl, a `photo` built from them).
    assert.doesNotMatch(source, /<(img|Image)\b[^>]*src=\{\s*(photo|currentUrl|[\w.?]*\.(image|imageUrl))\b/, name);
  }
  for (const name of ['sales/product-grid.tsx', 'sales/cart-summary.tsx', 'inventory/product-table.tsx', 'inventory/product-header.tsx', 'inventory/product-image-upload.tsx']) {
    assert.match(readFileSync(join(COMPONENTS, name), 'utf8'), /<ProductPhoto\b/, name);
  }
});
