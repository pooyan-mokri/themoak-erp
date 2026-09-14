import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '@/lib/prisma';

export { prisma };

let deploySql: Promise<unknown> | null = null;

const TEST_DB_NAME = /(^|_)test(_|$)/i;

/**
 * These tests TRUNCATE every table. Refuse to run unless DATABASE_URL points at
 * a local database whose name marks it as a test database, so a mistyped URL
 * can never wipe the real ERP.
 */
export function assertTestDatabase() {
  let url: URL;
  try {
    url = new URL(process.env.DATABASE_URL ?? '');
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.');
  }
  // Prisma connects to ?host= when present, not to the hostname before it.
  const host = url.searchParams.get('host') || url.hostname;
  const local = host.startsWith('/') || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!local || !TEST_DB_NAME.test(name)) {
    throw new Error(
      `Refusing to run: these tests wipe the database, and "${name}" on "${host}" is not a local test database.`,
    );
  }
}

export async function resetDatabase() {
  assertTestDatabase();
  // Check again against the database we are actually connected to.
  const [{ db }] = (await prisma.$queryRawUnsafe('SELECT current_database() AS db')) as Array<{ db: string }>;
  if (!TEST_DB_NAME.test(db)) throw new Error(`Refusing to truncate "${db}": not a test database.`);
  // What a deploy creates before prisma db push (tables, the stock-push triggers), once per test process.
  deploySql ??= prisma.$executeRawUnsafe(
    readFileSync(join(process.cwd(), 'prisma/sql/pre-push-unique-columns.sql'), 'utf8'),
  );
  await deploySql;
  await prisma.$executeRawUnsafe(`DO $$ DECLARE r record; BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' LOOP
      EXECUTE 'TRUNCATE TABLE "' || r.tablename || '" CASCADE';
    END LOOP;
  END $$;`);
}

export function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [key, value] of Object.entries(fields)) f.append(key, value);
  return f;
}
