import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { localDateString } from '@/lib/date-utils';

// Rules checked on the source itself, so a new screen cannot bring the bugs back.

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const files = sourceFiles(join(process.cwd(), 'src')).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
const hits = (pattern: RegExp) =>
  files.flatMap(({ path, text }) =>
    text.split('\n').flatMap((line, i) => (pattern.test(line) ? [`${path.replace(process.cwd() + '/', '')}:${i + 1}: ${line.trim()}`] : [])),
  );

test('a day picked in the Jalali picker is sent as the browser\'s calendar day, never the UTC day before it', () => {
  // Local midnight of 1 Mehr in Tehran is 20:30 UTC the day before: toISOString() names the wrong day.
  assert.deepEqual(hits(/selectedDate\??\.toISOString\(\)\.(split|slice|substring)/), []);
  const picked = new Date(2026, 8, 23); // local midnight, as the picker gives it
  assert.equal(localDateString(picked), '2026-09-23');
});

test('screen-reader labels are Persian', () => {
  assert.deepEqual(hits(/sr-only">\s*[A-Za-z]/), []);
  assert.deepEqual(hits(/aria-label="[A-Za-z]/), []);
});
