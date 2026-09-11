/**
 * webId — the identifier this ERP shares with the website (docs/erp-prompt.md §2).
 *
 * Not the SKU (that belongs to stock and accounting, and gets edited) and not
 * the database id (gone if the ERP is ever rebuilt). Unique, and immutable once
 * set: changing it silently points the site at a different product. null means
 * "not sold on the site".
 */
export const WEB_ID_PATTERN = /^MOAK-[A-Z0-9]+(-[A-Z0-9]+)*$/;

export type WebIdInput = { ok: true; value: string | null } | { ok: false; message: string };

/** Trim, treat empty as null, and reject anything outside the MOAK- format. */
export function parseWebId(raw: unknown): WebIdInput {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value === '') return { ok: true, value: null };
  if (!WEB_ID_PATTERN.test(value)) {
    return {
      ok: false,
      message:
        'شناسهٔ سایت باید مثل MOAK-PANJ-BLUE باشد: با MOAK- شروع شود و فقط حروف بزرگ انگلیسی، عدد و خط تیره داشته باشد.',
    };
  }
  return { ok: true, value };
}

/**
 * A readable message when another product already holds `webId`, else null.
 * `client` is a Prisma client or an interactive transaction.
 */
export async function webIdConflictMessage(
  client: any,
  webId: string,
  exceptProductId?: string,
): Promise<string | null> {
  const owner = await client.product.findUnique({
    where: { webId },
    select: { id: true, name: true, sku: true },
  });
  if (!owner || owner.id === exceptProductId) return null;
  return `شناسهٔ سایت «${webId}» قبلاً به کالای «${owner.name}» (${owner.sku}) داده شده است.`;
}

/** True for the unique-index error on webId — a race the pre-check lost. */
export function isWebIdUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; meta?: { target?: unknown } } | null;
  return e?.code === 'P2002' && String(e.meta?.target ?? '').includes('webId');
}
