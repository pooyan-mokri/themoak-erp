// postbuild, when the build made .next/standalone (Liara, and local runs of it; not Vercel). Liara's runtime holds
// only that folder (plus .next/static and public), and the server runs scripts/db-deploy.mjs from it when it starts
// (src/lib/live-server.ts). A file missing from it would stop the server at start, so the build fails here instead:
// every file is checked, and the Prisma CLI is run from inside the folder to show it loads with its engines.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = join(process.cwd(), '.next', 'standalone');
const migrations = readdirSync('prisma/migrations', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const backfills = readdirSync('prisma/sql').filter((name) => name.startsWith('backfill-'));
const required = [
  'server.js',
  'package.json',
  'scripts/db-deploy.mjs',
  'prisma/schema.prisma',
  'prisma/sql/pre-push-unique-columns.sql',
  ...backfills.map((name) => `prisma/sql/${name}`),
  ...migrations.map((name) => `prisma/migrations/${name}/migration.sql`),
  'node_modules/prisma/build/index.js',
  'node_modules/@prisma/engines/package.json',
  'node_modules/@prisma/client/package.json',
  'node_modules/.prisma/client/index.js',
];
const missing = required.filter((file) => !existsSync(join(root, file)));
const engines = existsSync(join(root, 'node_modules/@prisma/engines'))
  ? readdirSync(join(root, 'node_modules/@prisma/engines')).filter((name) => name.startsWith('schema-engine'))
  : [];
if (engines.length === 0) missing.push('node_modules/@prisma/engines/schema-engine-*');

if (missing.length > 0) {
  console.error(`[verify-standalone] .next/standalone lacks what the server runs at start:\n  ${missing.join('\n  ')}`);
  console.error('[verify-standalone] see outputFileTracingIncludes in next.config.js');
  process.exit(1);
}
const cli = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', '--version'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, CHECKPOINT_DISABLE: '1' },
});
if (cli.status !== 0 || !/schema-engine/i.test(cli.stdout ?? '')) {
  console.error('[verify-standalone] the Prisma CLI does not run from .next/standalone:\n', cli.stdout, cli.stderr);
  process.exit(1);
}
console.log(`[verify-standalone] ok: ${required.length} files, schema engine ${engines.join(', ')}; Prisma CLI runs from the standalone folder.`);
