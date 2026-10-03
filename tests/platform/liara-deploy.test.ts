// The move to Liara: what liara.json, package.json, next.config.js and the start hook promise, checked.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { prisma, resetDatabase } from '../helpers/db';
import { GET as health } from '@/app/api/health/route';
import { isLongRunningLiveServer, prepareLiveServer } from '@/lib/live-server';
import { STEPS } from '../../scripts/db-deploy.mjs';

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const liara = JSON.parse(read('liara.json'));
const vercel = JSON.parse(read('vercel.json'));
const LOCK = 7202610010002;

const ENV_KEYS = ['APP_ENV', 'VERCEL', 'VERCEL_ENV', 'TZ', 'NEXT_PHASE'] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
}
beforeEach(restoreEnv);
after(async () => {
  restoreEnv();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------- liara.json

test('liara.json deploys the themoak-erp app on the next platform, port 3000, built outside Iran', () => {
  assert.equal(liara.platform, 'next');
  assert.equal(liara.port, 3000);
  assert.equal(liara.next.nodeVersion, '22');
  assert.equal(liara.build.location, 'germany');
  assert.equal(liara.app, 'themoak-erp');
  assert.equal(liara.envs, undefined, 'envs in liara.json would replace every env var set in the panel');
});

// Liara runs vercel.json's two jobs at the same times, plus a stock-push retry every 2 minutes
// (on Vercel a failed push waited for the next stock change).
const HOOK_FLUSH = { schedule: '*/2 * * * *', path: '/api/site/hook-flush' };

test("liara.json's cron runs vercel.json's two jobs at the same times plus the stock-push retry, with CRON_SECRET, inside the container", () => {
  const jobs = liara.cron.map((line: string) => {
    const fields = line.split(' ');
    const url = fields.find((part) => part.startsWith('http://'));
    return { schedule: fields.slice(0, 5).join(' '), url, line };
  });
  assert.deepEqual(
    jobs.map(({ schedule, url }: any) => ({ schedule, path: new URL(url).pathname })).sort((a: any, b: any) => a.path.localeCompare(b.path)),
    [...vercel.crons.map((c: any) => ({ schedule: c.schedule, path: c.path })), HOOK_FLUSH].sort((a: any, b: any) => a.path.localeCompare(b.path)),
  );
  for (const { url, line } of jobs) {
    assert.equal(new URL(url).origin, `http://localhost:${liara.port}`);
    assert.ok(line.includes('-H "Authorization: Bearer $CRON_SECRET"'), line);
    assert.ok(line.includes('--fail'), `a refused call must show as failed: ${line}`);
  }
});

test('the cron command, run by a shell as Liara does, sends exactly the header the routes accept', async () => {
  const { createServer } = await import('node:http');
  const seen: Array<{ path?: string; authorization?: string }> = [];
  const server = createServer((req, res) => {
    seen.push({ path: req.url, authorization: req.headers.authorization });
    res.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  try {
    for (const line of liara.cron as string[]) {
      const command = line.split(' ').slice(5).join(' ').replace(`http://localhost:${liara.port}`, `http://127.0.0.1:${port}`);
      await new Promise<void>((resolve, reject) => {
        const child = spawn('/bin/sh', ['-c', command], { env: { PATH: process.env.PATH, CRON_SECRET: 'cron-secret-from-panel' } as unknown as NodeJS.ProcessEnv, stdio: 'ignore' });
        child.on('exit', (code: number | null) => (code === 0 ? resolve() : reject(new Error(`exit ${code}: ${command}`))));
      });
    }
  } finally {
    server.close();
  }
  assert.deepEqual(seen.map((s) => s.authorization), liara.cron.map(() => 'Bearer cron-secret-from-panel'));
  assert.deepEqual(seen.map((s) => s.path).sort(), ['/api/cron/backup', '/api/site/catalogue-sync', '/api/site/hook-flush']);
});

test("liara.json's health check asks /api/health, which answers 200 when the database answers", async () => {
  const command: string[] = liara.healthCheck.command;
  assert.equal(command[0], 'CMD');
  assert.ok(!command.includes('||'), 'an exec-form command gets no shell: || would be passed to curl as a URL');
  assert.ok(command.includes('--fail'));
  assert.equal(command.at(-1), `http://localhost:${liara.port}/api/health`);
  // Liara reads interval, timeout and startPeriod in milliseconds (liara init asks for "interval(ms)").
  assert.ok(liara.healthCheck.interval >= 10_000, 'interval is in milliseconds');
  assert.ok(liara.healthCheck.timeout >= 5_000 && liara.healthCheck.timeout <= 10_000, 'timeout is in milliseconds; Liara refuses more than 10000');
  assert.ok(liara.healthCheck.startPeriod <= 3_000, 'Liara refuses a startPeriod over 3000');
  // The first check runs one interval after start; unhealthy only after `retries` failures in a row.
  assert.ok(liara.healthCheck.interval * liara.healthCheck.retries >= 60_000, 'the database is brought up to date before the first answer');

  const res = await health();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('/api/health answers 503 when the database does not', async () => {
  const query = prisma.$queryRawUnsafe;
  (prisma as any).$queryRawUnsafe = async () => {
    throw new Error("Can't reach database server");
  };
  try {
    const res = await health();
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { ok: false });
  } finally {
    (prisma as any).$queryRawUnsafe = query;
  }
});

// ---------------------------------------------------------------- package.json and next.config.js

/** Whether `npm run build` runs db:sync first, in this environment. */
function buildSyncs(env: Record<string, string>) {
  // The database condition, without the leading `prisma generate &&` (it needs no database).
  const condition = pkg.scripts.build.replace(/^prisma generate && /, '').split('; then ')[0];
  const out = execFileSync('/bin/sh', ['-c', `${condition}; then echo sync; else echo skip; fi`], { env: { PATH: process.env.PATH, ...env } as unknown as NodeJS.ProcessEnv });
  return out.toString().trim() === 'sync';
}

test('the build brings the database up to date on Vercel and locally as before, but not on Liara (APP_ENV=production)', () => {
  assert.match(pkg.scripts.build, /npm run db:sync; fi && next build$/);
  // Liara runs `npm ci` with only package.json and the lockfile in place, so postinstall must not
  // need the schema; the build generates the client once the whole source is there.
  assert.match(pkg.scripts.build, /^prisma generate && /);
  assert.equal(pkg.scripts.postinstall, 'if [ -f prisma/schema.prisma ]; then prisma generate; fi');
  assert.equal(execFileSync('/bin/sh', ['-c', pkg.scripts.postinstall], { cwd: '/', env: { PATH: '/usr/bin:/bin' } as unknown as NodeJS.ProcessEnv }).toString(), '', 'without a schema, postinstall does nothing');
  assert.equal(buildSyncs({ VERCEL: '1' }), true, 'Vercel');
  assert.equal(buildSyncs({ VERCEL: '1', APP_ENV: 'production' }), true, 'Vercel, even with APP_ENV');
  assert.equal(buildSyncs({}), true, 'a local build, as before');
  assert.equal(buildSyncs({ APP_ENV: 'production' }), false, "Liara: its builder cannot reach the app's database");
  assert.equal(pkg.scripts.start, 'next start');
  assert.equal(pkg.scripts['db:deploy'], 'node scripts/db-deploy.mjs');
});

test("db:deploy runs db:sync's steps, in its order, with the same ones allowed to fail", () => {
  const steps = pkg.scripts['db:sync'].split(' && ').map((part: string) => {
    const mayFail = /\|\| true\)?$/.test(part);
    const args = part.replace(/^\(/, '').replace(/ \|\| true\)?$/, '').split(' ');
    assert.deepEqual(args.slice(0, 2), ['npx', 'prisma'], part);
    return { args: args.slice(2), mayFail };
  });
  assert.deepEqual(STEPS.map((s: any) => ({ args: s.args, mayFail: Boolean(s.mayFail) })), steps);
  // Every backfill the build runs, and nothing of the one-off data fixes.
  const backfills = readdirSync(join(ROOT, 'prisma/sql')).filter((name) => name.startsWith('backfill-')).sort();
  assert.deepEqual(STEPS.flatMap((s: any) => s.args.filter((a: string) => a.includes('backfill-')).map((a: string) => a.split('/').at(-1))).sort(), backfills);
  assert.ok(!JSON.stringify(STEPS).includes('datafix'));
});

/** next.config.js as Next.js loads it: plain Node, in its own process, with this environment. */
function loadNextConfig(env: Record<string, string | undefined>) {
  const childEnv: Record<string, string> = { PATH: process.env.PATH ?? '' };
  for (const [key, value] of Object.entries(env)) if (value !== undefined) childEnv[key] = value;
  const out = execFileSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(require("./next.config.js")))'], { cwd: ROOT, env: childEnv as unknown as NodeJS.ProcessEnv });
  return JSON.parse(out.toString());
}

test('next.config.js is the only config Next and Liara read, and keeps its settings on both hosts', () => {
  assert.ok(existsSync(join(ROOT, 'next.config.js')));
  assert.ok(!existsSync(join(ROOT, 'next.config.mjs')), 'Liara would write its own next.config.js beside it, which Next reads first');
  for (const env of [{ VERCEL: '1' }, { VERCEL: undefined }]) {
    const config = loadNextConfig(env);
    assert.equal(config.experimental.serverActions.bodySizeLimit, '5mb');
    assert.deepEqual(config.images.remotePatterns, [{ protocol: 'https', hostname: 'themoak.com' }]);
    assert.equal(config.experimental.instrumentationHook, true);
  }
});

test('outside Vercel the build is standalone and carries what the start hook runs; on Vercel neither', () => {
  const liaraConfig = loadNextConfig({ VERCEL: undefined, APP_COMMIT_SHA: 'abc123' });
  assert.equal(liaraConfig.output, 'standalone');
  assert.deepEqual(liaraConfig.env, { APP_COMMIT_SHA: 'abc123' });
  const includes: string[] = liaraConfig.experimental.outputFileTracingIncludes['/api/health'];
  for (const needed of ['./scripts/db-deploy.mjs', './prisma/schema.prisma', './prisma/sql/pre-push-unique-columns.sql', './prisma/sql/backfill-*.sql', './prisma/migrations/**/*', './node_modules/prisma/**/*', './node_modules/@prisma/engines/**/*']) {
    assert.ok(includes.includes(needed), needed);
  }
  const vercelConfig = loadNextConfig({ VERCEL: '1', APP_COMMIT_SHA: undefined });
  assert.equal(vercelConfig.output, undefined);
  assert.equal(vercelConfig.experimental.outputFileTracingIncludes, undefined);
  assert.equal(vercelConfig.env, undefined, 'Vercel gives VERCEL_GIT_COMMIT_SHA at runtime');
  // The postbuild check runs only where there is a standalone folder, and never needs scripts/ on Vercel.
  assert.match(pkg.scripts.postbuild, /^if \[ -d \.next\/standalone \] && \[ -f scripts\/verify-standalone\.mjs \]; then node scripts\/verify-standalone\.mjs; fi$/);
});

// ---------------------------------------------------------------- fonts

test('the fonts ship with the code: no Google Fonts fetch at build, the same families, weights and CSS variables', () => {
  const grep = spawnSync('grep', ['-rlE', `from ['"]next/font/google['"]`, join(ROOT, 'src')], { encoding: 'utf8' });
  assert.equal(grep.status, 1, `nothing imports next/font/google: ${grep.stdout}`);
  const layout = read('src/app/layout.tsx');
  assert.match(layout, /import localFont from "next\/font\/local";/);
  assert.match(layout, /src: "\.\/fonts\/Vazirmatn-wght\.woff2",\s*weight: "100 900"/);
  assert.match(layout, /variable: "--font-vazirmatn"/);
  assert.match(layout, /path: "\.\/fonts\/SpaceMono-Regular\.woff2", weight: "400"/);
  assert.match(layout, /path: "\.\/fonts\/SpaceMono-Bold\.woff2", weight: "700"/);
  assert.match(layout, /variable: "--font-space-mono"/);
  // tailwind.config.ts reads the same two variables.
  assert.match(read('tailwind.config.ts'), /var\(--font-vazirmatn\)[\s\S]*var\(--font-space-mono\)/);
  for (const file of ['Vazirmatn-wght.woff2', 'SpaceMono-Regular.woff2', 'SpaceMono-Bold.woff2']) {
    assert.equal(readFileSync(join(ROOT, 'src/app/fonts', file)).subarray(0, 4).toString('latin1'), 'wOF2', file);
  }
  for (const [file, holder] of [['OFL-Vazirmatn.txt', 'The Vazirmatn Project Authors'], ['OFL-SpaceMono.txt', 'The Space Mono Project Authors']]) {
    const licence = read(`src/app/fonts/${file}`);
    assert.ok(licence.includes(holder) && licence.includes('SIL OPEN FONT LICENSE Version 1.1'), file);
  }
});

// ---------------------------------------------------------------- the start hook

test('the start hook acts only on the live ERP on a long-running host', async () => {
  const cases: Array<[Record<string, string>, boolean]> = [
    [{}, false],
    [{ APP_ENV: 'development' }, false],
    [{ VERCEL: '1', VERCEL_ENV: 'production' }, false],
    [{ VERCEL: '1', VERCEL_ENV: 'production', APP_ENV: 'production' }, false],
    [{ APP_ENV: 'production' }, true],
  ];
  for (const [env, live] of cases) {
    restoreEnv();
    for (const key of ENV_KEYS) delete process.env[key];
    Object.assign(process.env, env);
    assert.equal(isLongRunningLiveServer(), live, JSON.stringify(env));
    let ran = 0;
    await prepareLiveServer({ run: async () => (ran++, 0), exit: () => assert.fail('no exit') });
    assert.equal(ran, live ? 1 : 0, JSON.stringify(env));
  }
});

test('on Liara the start hook pins the clock to UTC, and ends the process instead of serving when db:deploy fails', async () => {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.APP_ENV = 'production';
  process.env.TZ = 'Asia/Tehran';
  const warn = console.warn;
  const error = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    const exits: number[] = [];
    await prepareLiveServer({ run: async () => 0, exit: (code) => exits.push(code) });
    assert.equal(process.env.TZ, 'UTC');
    assert.equal(new Date('2026-10-01T23:30:00Z').getHours(), 23, 'the clock reads UTC');
    assert.equal(exits.length, 0);

    await prepareLiveServer({ run: async () => 1, exit: (code) => exits.push(code) });
    assert.equal(exits.join(), '1');

    // Never during `next build`, which on Liara has no database to reach.
    process.env.NEXT_PHASE = 'phase-production-build';
    let ran = false;
    await prepareLiveServer({ run: async () => ((ran = true), 1), exit: (code) => exits.push(code) });
    assert.equal(ran, false);
    assert.equal(exits.join(), '1');
  } finally {
    console.warn = warn;
    console.error = error;
  }
});

// ---------------------------------------------------------------- scripts/db-deploy.mjs, for real

/** Runs scripts/db-deploy.mjs against a database; resolves with its exit code and output. */
function dbDeploy(databaseUrl: string, onOutput?: (text: string) => void): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/db-deploy.mjs'], { cwd: ROOT, env: { ...process.env, DATABASE_URL: databaseUrl } });
    let output = '';
    const take = (chunk: Buffer) => {
      output += chunk.toString();
      onOutput?.(output);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('exit', (code) => resolve({ code: code ?? 1, output }));
  });
}

const lockHolder = () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('connection_limit', '1');
  return new PrismaClient({ datasourceUrl: url.toString() });
};
async function lockIsFree() {
  const probe = lockHolder();
  try {
    const [{ locked }]: any = await probe.$queryRawUnsafe(`SELECT pg_try_advisory_lock(${LOCK}) AS locked`);
    if (locked) await probe.$queryRawUnsafe(`SELECT pg_advisory_unlock(${LOCK})`);
    return locked as boolean;
  } finally {
    await probe.$disconnect();
  }
}

test('db:deploy brings a database up to date, then frees its lock; run again it changes nothing', async () => {
  await resetDatabase();
  const first = await dbDeploy(process.env.DATABASE_URL!);
  assert.equal(first.code, 0, first.output);
  assert.match(first.output, /\[db:deploy\] lock taken/);
  assert.match(first.output, /in sync with (your|the) Prisma schema/);
  assert.match(first.output, /\[db:deploy\] done in \d+s/);
  assert.equal(await lockIsFree(), true);
  const second = await dbDeploy(process.env.DATABASE_URL!);
  assert.equal(second.code, 0, second.output);
  assert.match(second.output, /already in sync/);
});

test('a second instance waits for the first one\'s lock, then runs', async () => {
  const holder = lockHolder();
  try {
    const [{ locked }]: any = await holder.$queryRawUnsafe(`SELECT pg_try_advisory_lock(${LOCK}) AS locked`);
    assert.equal(locked, true);
    let waiting!: () => void;
    const sawWaiting = new Promise<void>((resolve) => (waiting = resolve));
    const run = dbDeploy(process.env.DATABASE_URL!, (out) => out.includes('waiting for it') && waiting());
    await sawWaiting;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    let finished = false;
    run.then(() => (finished = true));
    assert.equal(finished, false, 'it does not run while the lock is held');
    await holder.$queryRawUnsafe(`SELECT pg_advisory_unlock(${LOCK})`);
    const { code, output } = await run;
    assert.equal(code, 0, output);
    assert.ok(output.indexOf('waiting for it') < output.indexOf('lock taken'));
  } finally {
    await holder.$disconnect();
  }
});

test('db:deploy ends non-zero, running nothing after it, when a step fails or the database is unreachable', async () => {
  await resetDatabase();
  // A column the code does not know, with data in it: db push refuses to drop it without --accept-data-loss.
  await prisma.$executeRawUnsafe(`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "liara_probe" text`);
  try {
    await prisma.$executeRawUnsafe(`INSERT INTO "Lead" ("id", "name", "liara_probe", "updatedAt") VALUES ('probe', 'probe', 'kept', now())`);
    const failed = await dbDeploy(process.env.DATABASE_URL!);
    assert.notEqual(failed.code, 0, failed.output);
    assert.match(failed.output, /data loss/i);
    assert.match(failed.output, /\[db:deploy\] failed \(exit \d+\); the steps after it were not run/);
    assert.ok(!failed.output.includes('backfill-order-money'), 'no backfill ran after the failed push');
    const [{ kept }]: any = await prisma.$queryRawUnsafe(`SELECT "liara_probe" AS kept FROM "Lead" WHERE id = 'probe'`);
    assert.equal(kept, 'kept', 'nothing was dropped');
    assert.equal(await lockIsFree(), true, 'the lock ended with the process');
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Lead" DROP COLUMN IF EXISTS "liara_probe"`);
    await prisma.$executeRawUnsafe(`DELETE FROM "Lead" WHERE id = 'probe'`);
  }

  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/erp_liara_no_such_db_test';
  const unreachable = await dbDeploy(url.toString());
  assert.equal(unreachable.code, 1, unreachable.output);
  assert.match(unreachable.output, /\[db:deploy\] failed:/);

  const noUrl = spawnSync(process.execPath, ['scripts/db-deploy.mjs'], { cwd: ROOT, env: { PATH: process.env.PATH } as unknown as NodeJS.ProcessEnv, encoding: 'utf8' });
  assert.equal(noUrl.status, 1);
  assert.match(noUrl.stderr, /DATABASE_URL is not set/);
});
