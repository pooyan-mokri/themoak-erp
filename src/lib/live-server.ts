// Server-only: run once by src/instrumentation.ts when a Node server starts, before it serves anything.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { isLiveErp } from '@/lib/deployment';

/**
 * The live ERP on a long-running host (Liara: APP_ENV=production, not Vercel). Vercel's functions start
 * many times and have their database brought up to date by the build instead.
 */
export function isLongRunningLiveServer(): boolean {
  return isLiveErp() && !process.env.VERCEL;
}

/** scripts/db-deploy.mjs in a process of its own; resolves with its exit code. */
export function runDbDeploy(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(process.cwd(), 'scripts', 'db-deploy.mjs')], { stdio: 'inherit', env: process.env });
    child.on('error', (error) => {
      console.error('[start] could not run scripts/db-deploy.mjs:', error);
      resolve(1);
    });
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

/**
 * Before the live server serves: its clock reads UTC, as on Vercel (the date code was written for a UTC
 * server; Liara's containers default to Asia/Tehran), and the database matches this code. When the database
 * cannot be brought up to date, the process ends instead of serving pages against a schema they do not match.
 */
export async function prepareLiveServer(
  { run = runDbDeploy, exit = (code: number) => process.exit(code) }: { run?: () => Promise<number>; exit?: (code: number) => void } = {},
): Promise<void> {
  // Only a server about to serve: never `next build`, which has no database to reach on Liara.
  if (!isLongRunningLiveServer() || process.env.NEXT_PHASE === 'phase-production-build') return;
  if (process.env.TZ !== 'UTC') {
    console.warn(`[start] TZ was ${process.env.TZ ?? 'unset'}; the ERP runs in UTC, so it is set to UTC.`);
    process.env.TZ = 'UTC';
  }
  const code = await run();
  if (code !== 0) {
    console.error(`[start] the database could not be brought up to this code (db:deploy exit ${code}); not starting.`);
    exit(1);
  }
}
