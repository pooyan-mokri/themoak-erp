/**
 * What a failed action tells the user. Its own refusals are Persian and are
 * shown as they are. Anything else — a database error ("Invalid
 * `prisma.payroll.findUnique()` invocation: …"), a crash — is English with
 * internal detail; the user gets the action's own Persian message instead (the
 * server log keeps the error). Pure, so any action can share it.
 */
export function userMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  return /[؀-ۿ]/.test(message) ? message : fallback;
}
