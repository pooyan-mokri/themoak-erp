/**
 * What the ERP keeps from a website order (docs/erp-prompt.md §3) beyond the
 * columns an ERP order already has. Written by src/lib/site-sale.ts into
 * Order.siteData; read by the order page and the printed invoice.
 */

/** The product a line lands on when its webId is unknown. */
export const SITE_UNKNOWN_SKU = 'SITE-UNKNOWN';
export const SITE_UNKNOWN_NAME = 'کالای ناشناختهٔ سایت';

export const TAG_NEEDS_REVIEW = 'نیازمند بررسی';
export const TAG_STOCK_SHORTAGE = 'کسری موجودی';

/** Website orders are reversed on the website, so the ERP never reverses them twice. */
export const WEBSITE_ORDER_LOCKED =
  'این سفارش از سایت آمده است؛ لغو، مرجوعی یا بازپرداخت آن را در پنل سایت ثبت کنید.';

export type SiteShipTo = {
  province: string | null;
  city: string | null;
  address: string | null;
  postal: string | null;
  note: string | null;
};

export type SiteUnknownLine = {
  webId: string | null;
  name: string | null;
  quantity: number;
  unitPrice: number;
  siteProductId: string | null;
};

export type SiteStatusEvent = {
  status: string;
  at: string;
  receivedAt: string;
  trackingCode: string | null;
  amount: number | null;
  restock: boolean | null;
  refundId: string | null;
};

export type SiteOrderData = {
  issuedAt: string;
  tag: string | null;
  customer: {
    name: string | null;
    mobile: string;
    email: string | null;
    siteId: string | null;
    ordersBefore: number | null;
  };
  shipTo: SiteShipTo | null;
  shipping: {
    zone: string | null;
    carrier: string | null;
    freight: number | null;
    free: boolean | null;
    trackingCode: string | null;
  } | null;
  payment: {
    gateway: string | null;
    trackId: string | null;
    refNumber: string | null;
    paidAt: string | null;
    amount: number;
  };
  subtotal: number | null;
  discount: number;
  coupon: string | null;
  total: number;
  unknownLines: SiteUnknownLine[];
  history: SiteStatusEvent[];
  /** Why the order carries «نیازمند بررسی», in words a person can act on. */
  review: string[];
};

export function readSiteOrderData(value: unknown): SiteOrderData | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as SiteOrderData) : null;
}

/** One line for the address: province، city، address، کد پستی postal. */
export function formatShipTo(shipTo: SiteShipTo | null | undefined): string | null {
  if (!shipTo) return null;
  const parts = [shipTo.province, shipTo.city, shipTo.address, shipTo.postal ? `کد پستی ${shipTo.postal}` : null]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean);
  return parts.length ? parts.join('، ') : null;
}
