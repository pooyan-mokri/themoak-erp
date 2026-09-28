import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// The server renders a locale-less toLocaleString() in en-US digits while a Persian browser renders fa-IR
// digits: React reports a hydration error and the page mixes the two. Every number, date and time in src/
// names its locale ('fa-IR', or an explicit one where the digits are meant for a machine).

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [path] : [];
  });
}

test('no toLocaleString, toLocaleDateString or toLocaleTimeString in src/ leaves its locale to the runtime', () => {
  const offenders: string[] = [];
  for (const path of sourceFiles(join(process.cwd(), 'src'))) {
    const text = readFileSync(path, 'utf8');
    const pattern = /\.toLocale(?:String|DateString|TimeString)\(\s*(\)|undefined\b)|\bIntl\.(?:NumberFormat|DateTimeFormat)\(\s*(\)|undefined\b)/g;
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split('\n').length;
      offenders.push(`${relative(process.cwd(), path)}:${line}: ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the rule itself: a locale-less call is caught, a named one is not', () => {
  const pattern = /\.toLocale(?:String|DateString|TimeString)\(\s*(\)|undefined\b)/;
  assert.ok(pattern.test('amount.toLocaleString()'));
  assert.ok(pattern.test('date.toLocaleDateString(undefined, { month: "long" })'));
  assert.ok(pattern.test('time.toLocaleTimeString(\n)'));
  assert.ok(!pattern.test("amount.toLocaleString('fa-IR')"));
  assert.ok(!pattern.test("day.toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' })"));
});
