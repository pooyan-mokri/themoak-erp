import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The money forms are client components and this suite has no DOM, so these
 * read their source for the wiring the server-side protections depend on.
 */

const DIR = join(process.cwd(), 'src', 'components', 'accounting');
const source = (name: string) => readFileSync(join(DIR, `${name}.tsx`), 'utf8');

test('the expense, deposit, payment, transfer and exchange forms send a request id and renew it after a save', () => {
  for (const name of ['expense-form', 'deposit-form', 'withdrawal-form', 'transfer-form', 'currency-exchange-form']) {
    const code = source(name);
    assert.match(code, /const \[requestId, renewRequestId\] = useRequestId\(\);/, `${name}: no request id`);
    assert.match(code, /<RequestIdField value=\{requestId\} \/>/, `${name}: the id is not sent`);
    // Keyed by the id, the form's own fields are emptied when the id is renewed.
    assert.match(code, /<form key=\{requestId\} action=\{dispatch\}>/, `${name}: the fields are not reset`);
    assert.match(code, /renewRequestId\(\);/, `${name}: the id is never renewed`);
  }
});

test('the deposit, payment and expense forms take the currency of the chosen account, with no Toman default', () => {
  for (const name of ['expense-form', 'deposit-form', 'withdrawal-form']) {
    const code = source(name);
    assert.doesNotMatch(code, /useState(<string>)?\('TOMAN'\)/, `${name}: the currency still starts as TOMAN`);
    assert.match(code, /setCurrency\(accounts\.find\(\(\w+\) => \w+\.id === id\)\?\.currency \?\? ''\)/, `${name}: choosing an account does not set its currency`);
  }
});

test('every account picker in the accounting components shows accountLabel', () => {
  let pickers = 0;
  for (const file of readdirSync(DIR).filter((name) => name.endsWith('.tsx'))) {
    const code = readFileSync(join(DIR, file), 'utf8');
    const items = /(\w+)\.map\(\((\w+)\) => \(\s*<SelectItem key=\{\2\.id\} value=\{\2\.id\}>([\s\S]*?)<\/SelectItem>/g;
    for (const [, list, , label] of code.matchAll(items)) {
      if (!/account|targets/i.test(list)) continue;
      assert.match(label, /accountLabel\(/, `${file}: the ${list} picker shows «${label.trim()}»`);
      pickers++;
    }
  }
  assert.ok(pickers >= 15, `only ${pickers} account pickers found`);
});
