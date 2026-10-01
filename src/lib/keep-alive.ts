/**
 * Keeps work running after the response has been sent, on Vercel.
 *
 * This is all @vercel/functions' waitUntil does: Vercel puts the request
 * context on globalThis under this symbol. Outside Vercel (Liara's long-running
 * `next start`, tests, local dev) there is no context and none is needed: the
 * process stays up, so the promise simply runs to its end. Callers pass a
 * promise that never rejects and ends on its own deadline (kickSiteHook), so
 * nothing piles up. If Vercel ever moves the context, the work may be cut
 * short; the scheduled drain still delivers.
 */
export function keepAlive(promise: Promise<unknown>): void {
  const context = (globalThis as any)[Symbol.for('@vercel/request-context')]?.get?.();
  context?.waitUntil?.(promise);
}
