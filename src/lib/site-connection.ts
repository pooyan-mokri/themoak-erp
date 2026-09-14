import type { CatalogueSyncResult } from './site-catalogue';

/**
 * How this ERP reaches the website. Stored in SystemSetting; the webhook
 * secret is only ever read on the server and never sent back to the browser.
 */
export const SITE_CONNECTION_KEY = 'site_connection';
export const SITE_CATALOGUE_SYNC_KEY = 'site_catalogue_last_sync';
export const SITE_HOOK_STATUS_KEY = 'site_hook_status';
export const SITE_HOOK_HOLD_KEY = 'site_hook_hold';

/** Keys the generic, browser-reachable getSetting/saveSetting must never serve. */
export const SITE_SETTING_KEYS: readonly string[] = [
  SITE_CONNECTION_KEY,
  SITE_CATALOGUE_SYNC_KEY,
  SITE_HOOK_STATUS_KEY,
  SITE_HOOK_HOLD_KEY,
];

// The owner's defaults, used until something else is saved.
export const DEFAULT_PAYMENT_ACCOUNT_NAME = 'بانک سامان';
export const DEFAULT_SITE_WAREHOUSE_NAME = 'مشاهیر';

export type SiteConnection = {
  siteUrl: string | null;
  webhookSecret: string | null;
  paymentAccountId: string | null;
  warehouseId: string | null;
  /** Push stock changes to the site. Turned on only after /erp/ping confirms the warehouse. */
  stockPushEnabled: boolean;
};

/** What the settings page gets: everything except the secret itself. */
export type SiteConnectionForm = {
  siteUrl: string;
  hasSecret: boolean;
  paymentAccountId: string | null;
  warehouseId: string | null;
  accounts: Array<{ id: string; name: string; currency: string }>;
  warehouses: Array<{ id: string; name: string }>;
  lastSync: CatalogueSyncResult | null;
};

/** `client` is a Prisma client or an interactive transaction. */
export async function readSiteConnection(client: any): Promise<SiteConnection> {
  const row = await client.systemSetting.findUnique({ where: { key: SITE_CONNECTION_KEY } });
  let saved: Partial<SiteConnection> = {};
  try {
    saved = row?.value ? JSON.parse(row.value) : {};
  } catch {
    saved = {};
  }
  return {
    siteUrl: saved.siteUrl ?? null,
    webhookSecret: saved.webhookSecret ?? null,
    paymentAccountId: saved.paymentAccountId ?? null,
    warehouseId: saved.warehouseId ?? null,
    stockPushEnabled: saved.stockPushEnabled === true,
  };
}

/**
 * The site's base address as `origin + path` without a trailing slash, or null.
 * https is assumed when omitted. The webhook secret travels in a header to this
 * address, so plain http is refused except for a local test server, and so is
 * anything that could send it elsewhere: credentials (`https://a.com@evil.com`),
 * a query or a fragment.
 */
export function normalizeSiteUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Another scheme (ftp://…) must be refused, not turned into https://ftp://….
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  if (url.username || url.password || url.search || url.hash || trimmed.includes('#') || /\?/.test(trimmed)) return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/** The saved choice while it is still valid, else the item carrying the default name. */
export function pickWithDefault<T extends { id: string; name: string }>(
  list: T[],
  savedId: string | null,
  defaultName: string,
): string | null {
  if (savedId && list.some((x) => x.id === savedId)) return savedId;
  return (
    list.find((x) => x.name.trim() === defaultName)?.id ??
    list.find((x) => x.name.includes(defaultName))?.id ??
    null
  );
}
