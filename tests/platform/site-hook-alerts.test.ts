import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// A client component, so this checks its source: there is no DOM in these tests.
// Once the session ends, the banner's once-a-minute request is bounced by the
// middleware and the action's answer is not a list; setting it crashed the
// whole dashboard ("Cannot read properties of undefined (reading 'length')").
test('the stock push banner keeps what it shows when its action does not answer with a list', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/layout/site-hook-alerts.tsx'), 'utf8');
  const setters = [...source.matchAll(/setAlerts\(([^)]*)\)/g)];
  assert.equal(setters.length, 1);
  assert.match(source, /if \(current && Array\.isArray\(next\)\) setAlerts\(next\);/);
});
