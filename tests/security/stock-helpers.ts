// Shared by the tests/security/stock-*.test.ts files.

export const DENIED = 'شما به این بخش دسترسی ندارید.';

/** Paths in `value`, however deep, where one of `keys` holds something other than null or undefined. */
export function exposed(value: unknown, keys: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (node === null || typeof node !== 'object' || node instanceof Date) return;
    for (const [key, child] of Object.entries(node)) {
      const at = path ? `${path}.${key}` : key;
      if (keys.includes(key) && child !== null && child !== undefined) found.push(at);
      walk(child, at);
    }
  };
  walk(value, '');
  return found;
}

/** The fields a role without cost.view must never receive. */
export const COST_KEYS = ['costPrice', 'totalValue', 'discrepancyValue', 'inventoryValue', 'totalInventoryValue', 'currentStockValue'];
