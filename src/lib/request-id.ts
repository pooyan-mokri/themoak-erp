/**
 * One form submission books money once, even when it reaches the server twice
 * (a double click, a retry after a slow response, a resent MCP call).
 *
 * The form sends a random id with each submission (useRequestId in
 * src/components/ui/request-id.tsx). The writer stores it on the FIRST
 * Transaction row it creates, in the unique column Transaction.clientRequestId.
 * A second submission with the same id then fails the unique constraint inside
 * the same database transaction, so nothing of it is written, and the action
 * answers with DUPLICATE_REQUEST_MESSAGE as a success: the money is booked once.
 */

export const DUPLICATE_REQUEST_MESSAGE = 'این ثبت قبلاً انجام شده بود و دوباره ثبت نشد.';

/** The id from a form field or an API body; anything else is ignored (no id, no protection). */
export function readRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : null;
}

/** True when a write failed because this request id was already stored. */
export function isDuplicateRequest(error: unknown): boolean {
  // A Prisma unique-constraint failure (P2002), checked by shape.
  const known = error as { code?: unknown; meta?: { target?: unknown } } | null;
  if (!known || known.code !== 'P2002') return false;
  const target = known.meta?.target;
  const fields = Array.isArray(target) ? target : typeof target === 'string' ? [target] : [];
  return fields.some((field) => String(field).includes('clientRequestId'));
}
