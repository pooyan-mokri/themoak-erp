import { LOW_STOCK_MAX, stockLevel } from '@/lib/stock-levels';

/**
 * Stock status for the product list and the product page, as a colour and a word (design system §12).
 * One rule on every screen (src/lib/stock-levels.ts): out is 0 or less, low is 1 to LOW_STOCK_MAX (3).
 */
export { LOW_STOCK_MAX };

export type StockStatus = 'out' | 'low' | 'ok';

const STATUS_OF = { OUT: 'out', LOW: 'low', OK: 'ok' } as const;

export function stockStatus(quantity: number): StockStatus {
  return STATUS_OF[stockLevel(quantity)];
}

export const STOCK_STATUS: Record<StockStatus, { label: string; tone: string }> = {
  out: { label: 'ناموجود', tone: 'bg-danger-soft text-danger' },
  low: { label: 'کم', tone: 'bg-warning-soft text-warning' },
  ok: { label: 'موجود', tone: 'bg-success-soft text-success' },
};

export const PRODUCT_TYPE_LABELS: Record<string, string> = {
  SALEABLE: 'محصول فروختنی',
  FIXED_ASSET: 'دارایی ثابت',
  CONSUMABLE: 'کالای مصرفی',
  OTHER: 'سایر',
};

export const productTypeLabel = (type?: string) => PRODUCT_TYPE_LABELS[type || 'SALEABLE'] || 'نامشخص';
