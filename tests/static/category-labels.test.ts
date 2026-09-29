import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { categoryLabel } from '@/lib/category-labels';
import { EXPENSE_CATEGORIES } from '@/components/accounting/entry-categories';

// Found looking at the crawl's screenshots: the journal, the expense list and the P&L showed the categories the
// code stores in English (Sales, Office, …). Every English category the code writes has a Persian name.

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test('every English category the actions store, and every expense-form category, is named in Persian', () => {
  const stored = new Set<string>();
  for (const dir of ['src/actions', 'src/app/api', 'src/lib']) {
    for (const path of sourceFiles(join(process.cwd(), dir))) {
      for (const match of readFileSync(path, 'utf8').matchAll(/category: '([A-Za-z][A-Za-z _/-]*)'/g)) stored.add(match[1]);
    }
  }
  for (const c of EXPENSE_CATEGORIES) stored.add(c.value);
  assert.ok(stored.has('Sales') && stored.has('COGS') && stored.has('Office'), 'the scan finds the stored categories');
  for (const category of stored) assert.doesNotMatch(categoryLabel(category), /[A-Za-z]/, category);
  assert.equal(categoryLabel('اجاره مغازه'), 'اجاره مغازه', 'a category typed in Persian is shown as typed');
});
