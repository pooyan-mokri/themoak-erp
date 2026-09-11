import { WEB_ID_PATTERN } from './web-id';

/**
 * The website's read-only product list (docs/erp-prompt.md §5):
 * GET {SITE}/erp/catalogue with `Authorization: Bearer <webhookSecret>`.
 * Only what the ERP keeps is read: the front-of-frame photo and the page link.
 */
export type CatalogueItem = { webId: string; image: string | null; url: string | null };
export type CatalogueSkip = { key: string; why: string };

export type CatalogueFetchResult =
  | { ok: true; items: CatalogueItem[]; skipped: CatalogueSkip[] }
  | { ok: false; message: string };

export type CatalogueSyncResult = {
  ok: boolean;
  message: string;
  at: string;
  read?: number;
  updated?: number;
  unchanged?: number;
  notInErp?: string[];
  notOnSite?: string[];
  skipped?: CatalogueSkip[];
};

/** The value itself when it is an absolute http(s) URL, else null. */
function absoluteUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const { protocol } = new URL(value.trim());
    return protocol === 'https:' || protocol === 'http:' ? value.trim() : null;
  } catch {
    return null;
  }
}

export function parseCatalogue(body: unknown): CatalogueFetchResult {
  const products = (body as { products?: unknown } | null)?.products;
  if (!Array.isArray(products)) {
    return { ok: false, message: 'پاسخ سایت شکل کاتالوگ را ندارد (فهرست products پیدا نشد).' };
  }

  const webIdOf = (raw: any) => (typeof raw?.webId === 'string' ? raw.webId.trim() : '');
  const seen = new Map<string, number>();
  for (const raw of products) seen.set(webIdOf(raw), (seen.get(webIdOf(raw)) ?? 0) + 1);

  const items: CatalogueItem[] = [];
  const skipped: CatalogueSkip[] = [];
  for (const raw of products as any[]) {
    const webId = webIdOf(raw);
    if (!WEB_ID_PATTERN.test(webId)) {
      skipped.push({ key: String(raw?.webId ?? raw?.slug ?? '?'), why: 'شناسهٔ سایت ندارد یا قالبش نامعتبر است' });
    } else if ((seen.get(webId) ?? 0) > 1) {
      // Two entries for one webId: there is no way to know which photo is right.
      skipped.push({ key: webId, why: 'در کاتالوگ سایت تکراری است' });
    } else {
      items.push({ webId, image: absoluteUrl(raw.image), url: absoluteUrl(raw.url) });
    }
  }
  return { ok: true, items, skipped };
}

export async function fetchSiteCatalogue(opts: {
  siteUrl: string;
  secret: string;
  timeoutMs?: number;
}): Promise<CatalogueFetchResult> {
  const endpoint = `${opts.siteUrl.replace(/\/+$/, '')}/erp/catalogue`;
  let res: Response;
  try {
    res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${opts.secret}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
  } catch (error) {
    const timedOut = (error as { name?: string } | null)?.name === 'TimeoutError';
    return {
      ok: false,
      message: timedOut ? 'سایت در زمان مقرر جواب نداد.' : `به سایت وصل نشد (${endpoint}). آدرس سایت را بررسی کنید.`,
    };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, message: 'سایت رمز را نپذیرفت. «رمز وبهوک» را با پنل سایت مقایسه کنید.' };
  }
  if (res.status === 404) {
    return { ok: false, message: `کاتالوگ در این آدرس پیدا نشد (${endpoint}). آدرس سایت را بررسی کنید.` };
  }
  if (!res.ok) return { ok: false, message: `سایت خطای ${res.status} داد.` };

  let body: unknown;
  try {
    body = await res.json();
  } catch (error) {
    // The deadline also covers reading the body.
    const name = (error as { name?: string } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, message: 'سایت در زمان مقرر جواب نداد.' };
    }
    return { ok: false, message: 'پاسخ سایت JSON معتبر نبود.' };
  }
  return parseCatalogue(body);
}

export type ErpProductForSync = {
  id: string;
  webId: string | null;
  imageUrl: string | null;
  siteUrl: string | null;
};

export type CatalogueSyncPlan = {
  updates: Array<{ id: string; webId: string; imageUrl: string | null; siteUrl: string | null }>;
  unchanged: number;
  notInErp: string[]; // listed on the site, but no ERP product has this webId
  notOnSite: string[]; // an ERP product has this webId, but the site didn't list it
};

/**
 * Match strictly by webId. A product without one can never match, so it is
 * never touched; that is the job of the webId page, not of this sync.
 */
export function planCatalogueSync(items: CatalogueItem[], products: ErpProductForSync[]): CatalogueSyncPlan {
  const byWebId = new Map(products.filter((p) => p.webId).map((p) => [p.webId as string, p]));
  const listed = new Set(items.map((i) => i.webId));

  const updates: CatalogueSyncPlan['updates'] = [];
  const notInErp: string[] = [];
  let unchanged = 0;
  for (const item of items) {
    const product = byWebId.get(item.webId);
    if (!product) {
      notInErp.push(item.webId);
      continue;
    }
    // A missing photo or link on the site never blanks what the ERP already shows.
    const imageUrl = item.image ?? product.imageUrl;
    const siteUrl = item.url ?? product.siteUrl;
    if (imageUrl === product.imageUrl && siteUrl === product.siteUrl) {
      unchanged++;
      continue;
    }
    updates.push({ id: product.id, webId: item.webId, imageUrl, siteUrl });
  }
  const notOnSite = [...byWebId.keys()].filter((webId) => !listed.has(webId));
  return { updates, unchanged, notInErp, notOnSite };
}
