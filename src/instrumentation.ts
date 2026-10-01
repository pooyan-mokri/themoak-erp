/**
 * Runs once when a Next.js server starts (experimental.instrumentationHook in next.config.js), and the server
 * waits for it before handling any request. On the live ERP on Liara it pins the clock to UTC and brings the
 * database up to this code first (src/lib/live-server.ts); everywhere else it does nothing.
 */
export async function register() {
  // This exact form lets the Edge build drop the import (Node-only modules) at compile time.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { prepareLiveServer } = await import('@/lib/live-server');
    await prepareLiveServer();
  }
}
