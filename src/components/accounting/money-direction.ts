/**
 * Whether a journal row put money into its account (+1) or took it out (−1),
 * by the same rule the balance reconciliation signs rows with
 * (src/lib/balance-reconciliation.ts balanceEffect). Pure, for client lists.
 */
export function directionOf(row: { type: string; amount?: number | null; description?: string | null }): 1 | -1 {
  switch (row.type) {
    case 'INCOME':
      return 1;
    case 'EXPENSE':
      return -1;
    case 'ADJUSTMENT':
      // Stored signed.
      return (row.amount ?? 0) < 0 ? -1 : 1;
    case 'TRANSFER':
      // «[ورود]» is the incoming leg; «[خروج]» and the unprefixed API leg go out.
      return (row.description ?? '').startsWith('[ورود]') ? 1 : -1;
    default:
      return 1;
  }
}
