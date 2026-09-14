/**
 * Keeps work running after the response has been sent, on Vercel.
 *
 * This is all @vercel/functions' waitUntil does: Vercel puts the request
 * context on globalThis under this symbol. Outside Vercel (tests, local dev)
 * there is no context and the promise simply runs unguarded. If Vercel ever
 * moves the context, the work may be cut short; the scheduled drain still
 * delivers.
 */
export function keepAlive(promise: Promise<unknown>): void {
  const context = (globalThis as any)[Symbol.for('@vercel/request-context')]?.get?.();
  context?.waitUntil?.(promise);
}
