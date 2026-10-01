/**
 * Where this copy of the ERP runs, without naming the host.
 *
 * The live ERP is APP_ENV=production on any host (Liara), or Vercel's
 * production deployment until the move. Vercel previews, development and
 * tests are not it.
 */
export function isLiveErp(): boolean {
  return process.env.APP_ENV === 'production' || process.env.VERCEL_ENV === 'production';
}

/**
 * Any deployed copy: the live ERP, or any Vercel deployment (previews too).
 * Its own disk is no place for receipts or photos: a container's files go with
 * the next deploy, and a Vercel function cannot keep them at all.
 */
export function isDeployed(): boolean {
  return isLiveErp() || Boolean(process.env.VERCEL);
}

/**
 * The commit the running code was built from, when known: Vercel's, else
 * APP_COMMIT_SHA (set on the host, or baked in by next.config.mjs at build
 * time when the build has git).
 */
export function codeCommit(): string | undefined {
  return process.env.VERCEL_GIT_COMMIT_SHA || process.env.APP_COMMIT_SHA || undefined;
}
