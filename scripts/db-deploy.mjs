// Brings the database up to this code before the server serves: the deploy SQL, prisma db push and the
// backfills, the same steps, in the same order, as `npm run db:sync` (package.json), under a Postgres advisory
// lock. Vercel runs db:sync from its build until the move. On Liara the build cannot be relied on to reach the
// database (it runs on Liara's builders, outside the app's private network), so the server runs this script when
// it starts (src/instrumentation.ts → src/lib/live-server.ts), and refuses to serve when it fails. By hand:
//
//   DATABASE_URL="<database url>" node scripts/db-deploy.mjs        (npm run db:deploy)
//
// Liara's runtime holds only Next's standalone output, without npm, npx or node_modules/.bin, so the Prisma CLI
// is run with node directly; next.config.js copies it, its engines and these files into that output.
//
// Two instances starting together (a deploy while the old one runs, a restart) take turns: the second waits for
// the lock, then runs the same steps, which change nothing the second time (they already run on every Vercel
// build). Any failing step ends this script non-zero. The lock is a session lock on a connection of its own: it
// ends with this process, even if the process is killed.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';

/** Unique to this script; prisma/sql/pre-push-unique-columns.sql takes its own, 7202609120001, inside. */
const LOCK = 7202610010002;
const WAIT_MS = Number(process.env.DB_DEPLOY_LOCK_WAIT_MS) || 15 * 60_000;
const SCHEMA = ['--schema', './prisma/schema.prisma'];
const sql = (file) => ['db', 'execute', ...SCHEMA, '--file', `./prisma/sql/${file}`];

/** db:sync's steps. A step marked `mayFail` is `|| true` there. */
export const STEPS = [
  { args: ['migrate', 'resolve', '--applied', '20260625000000_heal_missing_columns'], mayFail: true },
  { args: sql('pre-push-unique-columns.sql') },
  { args: ['db', 'push', '--skip-generate'] },
  { args: sql('backfill-purchase-payments.sql'), mayFail: true },
  { args: sql('backfill-order-money.sql') },
  { args: sql('backfill-consignment-channels.sql') },
  { args: sql('backfill-order-exchange-items.sql'), mayFail: true },
];

const log = (message) => console.log(`[db:deploy] ${message}`);

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('[db:deploy] DATABASE_URL is not set: there is no database to bring up to date.');
    return 1;
  }
  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  // One connection, so the lock and its release are on the same session.
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('connection_limit', '1');
  const prisma = new PrismaClient({ datasourceUrl: url.toString() });
  try {
    const started = Date.now();
    for (let attempt = 0; ; attempt++) {
      const [{ locked }] = await prisma.$queryRawUnsafe(`SELECT pg_try_advisory_lock(${LOCK}) AS locked`);
      if (locked) break;
      if (Date.now() - started > WAIT_MS) throw new Error(`another instance held the schema lock for ${WAIT_MS / 1000}s`);
      if (attempt === 0) log('another instance is bringing the database up to date; waiting for it');
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    log('lock taken');
    for (const step of STEPS) {
      log(`prisma ${step.args.join(' ')}`);
      const run = spawnSync(process.execPath, [prismaCli, ...step.args], {
        stdio: 'inherit',
        // No update check or telemetry call to prisma.io from the server.
        env: { ...process.env, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
      });
      if (run.error) throw run.error;
      if (run.status !== 0 && !step.mayFail) {
        log(`failed (exit ${run.status}); the steps after it were not run`);
        return run.status || 1;
      }
    }
    await prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(${LOCK})`);
    log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
    return 0;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error('[db:deploy] failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
