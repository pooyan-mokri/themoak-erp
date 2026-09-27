/**
 * G-then-letter jumps (design: «G D» داشبورد …). The palette shows the same
 * letters next to its destinations, so this is the one list of them.
 */
export const G_SHORTCUTS: Record<string, string> = {
  d: '/dashboard',
  s: '/dashboard/sales/history',
  p: '/dashboard/sales/pos',
  i: '/dashboard/inventory',
  a: '/dashboard/accounting',
  t: '/dashboard/accounting/transactions',
  c: '/dashboard/crm/customers',
  r: '/dashboard/reports',
};

export function shortcutFor(href: string): string | undefined {
  const key = Object.keys(G_SHORTCUTS).find((k) => G_SHORTCUTS[k] === href);
  return key ? `G ${key.toUpperCase()}` : undefined;
}
