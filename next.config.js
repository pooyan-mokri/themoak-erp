// This file must stay next.config.js (CommonJS). Liara looks for next.config.js only: when it finds none, it
// writes its own with nothing but `output: 'standalone'`, and Next.js reads next.config.js before .mjs, so every
// setting below would be dropped (docs.liara.ir/paas/nextjs/fix-common-errors/modify-config-file; next.config.ts
// would need TypeScript installed where Liara builds).
const { execSync } = require('node:child_process');

// Vercel builds the app its own way; everything below marked "not on Vercel" is for Liara (and local runs of it).
const onVercel = Boolean(process.env.VERCEL);

/** The commit being built, for backups' "Code:" line (src/lib/deployment.ts): the host's, else git's when the build has it. */
function buildCommit() {
  if (process.env.APP_COMMIT_SHA) return process.env.APP_COMMIT_SHA;
  if (onVercel) return undefined; // VERCEL_GIT_COMMIT_SHA is read at runtime
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || undefined;
  } catch {
    return undefined;
  }
}
const commit = buildCommit();

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Not on Vercel: Liara runs only .next/standalone (with .next/static and public), so set it here rather than
  // let Liara rewrite this file.
  ...(onVercel ? {} : { output: 'standalone' }),
  ...(commit ? { env: { APP_COMMIT_SHA: commit } } : {}),
  experimental: {
    // A receipt photo or PDF is sent to a server action (src/actions/upload.ts),
    // up to 4 MB; the default limit is 1 MB.
    serverActions: { bodySizeLimit: '5mb' },
    // src/instrumentation.ts runs on its own since Next.js 15 (it brings the database up to this code on Liara
    // before the server serves): no flag here.
  },
  // Not on Vercel: what src/instrumentation.ts runs at start (scripts/db-deploy.mjs: the Prisma CLI with its
  // engines, the schema and the deploy SQL) is not imported by any page, so file tracing would leave it out of
  // the standalone output. Tied to /api/health only because includes are listed per route; the standalone
  // output gets every route's files. scripts/verify-standalone.mjs (postbuild) checks they are there.
  ...(onVercel
    ? {}
    : {
        outputFileTracingIncludes: {
          '/api/health': [
            './scripts/db-deploy.mjs',
            './prisma/schema.prisma',
            './prisma/migrations/**/*',
            './prisma/sql/pre-push-unique-columns.sql',
            './prisma/sql/backfill-*.sql',
            './node_modules/prisma/**/*',
            './node_modules/@prisma/engines/**/*',
            './node_modules/@prisma/engines-version/**/*',
            './node_modules/@prisma/debug/**/*',
            './node_modules/@prisma/fetch-engine/**/*',
            './node_modules/@prisma/get-platform/**/*',
          ],
        },
      }),
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'themoak.com',
      },
    ],
  },
};

module.exports = nextConfig;
