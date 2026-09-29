import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { DataTable } from '@/components/ui/data-table';

// Every list's «نمایش ۱ تا ۷ از ۷ آیتم» line and its page count were in Latin digits on a Persian page.

(globalThis as any).React = React;

test('the shared table counts its rows and pages in Persian digits', () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: String(i), name: `ردیف ${i}` }));
  const html = renderToString(React.createElement(DataTable as any, { data: rows, columns: [{ key: 'name', label: 'نام' }], pageSize: 10 }))
    .replace(/<!-- -->/g, '');
  assert.match(html, /نمایش ۱ تا ۱۰ از ۲۵ آیتم/);
  assert.match(html, /صفحه ۱ از ۳/);
  assert.doesNotMatch(html, /نمایش \d/);
});
