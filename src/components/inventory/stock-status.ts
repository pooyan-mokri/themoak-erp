/**
 * Stock status for the product list and the product page, as a colour and a word (design system §12).
 * Low is under 10 units, the threshold the dashboard's stock alert (getLowStockItems) and the
 * product page's warehouse breakdown already use.
 */
export const LOW_STOCK_BELOW = 10;

export type StockStatus = 'out' | 'low' | 'ok';

export function stockStatus(quantity: number): StockStatus {
  if (quantity <= 0) return 'out';
  return quantity < LOW_STOCK_BELOW ? 'low' : 'ok';
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
