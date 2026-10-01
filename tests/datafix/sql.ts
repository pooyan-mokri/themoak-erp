import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../helpers/db';

/** A file of prisma/sql. */
export const sqlFile = (name: string) => readFileSync(join(process.cwd(), 'prisma/sql', name), 'utf8');

/** Run one data fix (a single DO block) as psql would. */
export const runFix = (name: string) => prisma.$executeRawUnsafe(sqlFile(name));

/** The statements of a read-only report, comments dropped. */
function reportStatements(name: string): string[] {
  const body = sqlFile(name)
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  return body.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
}

/** The rows the n-th statement (from 0) of a read-only report returns. */
export async function reportRows(name: string, n = 0): Promise<any[]> {
  return prisma.$queryRawUnsafe(reportStatements(name)[n]);
}

/** Each table's content, hashed: a table whose hash is unchanged was not touched. */
export async function tableHashes(): Promise<Record<string, string>> {
  const tables = (await prisma.$queryRawUnsafe(
    `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY 1`,
  )) as Array<{ name: string }>;
  const hashes: Record<string, string> = {};
  for (const { name } of tables) {
    const [{ hash }] = (await prisma.$queryRawUnsafe(
      `SELECT md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) AS hash FROM "${name}" x`,
    )) as Array<{ hash: string }>;
    hashes[name] = hash;
  }
  return hashes;
}

/** The tables whose content differs between two tableHashes(). */
export function changedTables(before: Record<string, string>, after: Record<string, string>): string[] {
  return Object.keys(after).filter((name) => before[name] !== after[name]).sort();
}

/** A table's rows other than `except` (by id), hashed. */
export async function rowsHash(table: string, except: string[] = []): Promise<string> {
  const [{ hash }] = (await prisma.$queryRawUnsafe(
    `SELECT md5(COALESCE(string_agg(x::text, '|' ORDER BY x::text), '')) AS hash FROM "${table}" x WHERE NOT (x.id = ANY($1::text[]))`,
    except,
  )) as Array<{ hash: string }>;
  return hash;
}

/**
 * Run a fix twice. The first run may change only `tables`; the second changes
 * nothing at all. Returns the hashes before and after the first run.
 */
export async function runTwice(name: string, tables: string[]) {
  const before = await tableHashes();
  await runFix(name);
  const after = await tableHashes();
  assert.deepEqual(changedTables(before, after), [...tables].sort(), `${name} changed other tables`);
  await runFix(name);
  assert.deepEqual(changedTables(after, await tableHashes()), [], `${name} is not idempotent`);
  return { before, after };
}

/** Every account's id and stored balance. */
export async function balances(): Promise<Record<string, number>> {
  const accounts = await prisma.account.findMany({ select: { id: true, balance: true } });
  return Object.fromEntries(accounts.map((a: any) => [a.id, Number(a.balance)]));
}
