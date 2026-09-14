'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import {
  DEFAULT_PAYMENT_ACCOUNT_NAME,
  DEFAULT_SITE_WAREHOUSE_NAME,
  SITE_CATALOGUE_SYNC_KEY,
  SITE_CONNECTION_KEY,
  normalizeSiteUrl,
  pickWithDefault,
  readSiteConnection,
  type SiteConnection,
  type SiteConnectionForm,
} from '@/lib/site-connection';
import { fetchSiteCatalogue, type CatalogueSyncResult } from '@/lib/site-catalogue';
import { runCatalogueSync } from '@/lib/site-catalogue-sync';
import {
  approveStockZeros as approveStockZerosCore,
  clearSiteHookHold as clearSiteHookHoldCore,
  clearSiteHookPause as clearSiteHookPauseCore,
  enqueueFullResync as enqueueFullResyncCore,
  kickSiteHook as kickSiteHookCore,
  pingSite as pingSiteCore,
  previewStockPush as previewStockPushCore,
  readSiteHookHold as readSiteHookHoldCore,
  readSiteHookStatus as readSiteHookStatusCore,
  releaseSiteHookHold as releaseSiteHookHoldCore,
  type SiteHookHold,
  type SiteHookStatus,
  type StockPushPreview,
} from '@/lib/site-hook';
import { siteHookAlerts } from '@/components/layout/site-hook-banner';

const ADMIN_ONLY = 'فقط مدیر سیستم می‌تواند اتصال سایت را مدیریت کند.';
const CHANGED_MEANWHILE = 'تنظیمات اتصال سایت همین حالا تغییر کرد؛ صفحه را تازه کنید و دوباره امتحان کنید.';
const INVALID_LIST = 'درخواست نامعتبر است؛ صفحه را تازه کنید و دوباره بررسی کنید.';
const PREVIEW_CHANGED = 'موجودی یا سایت از زمان بررسی تغییر کرده؛ دوباره بررسی کنید.';
const HOLD_WAITING =
  'فریم‌هایی منتظر تأیید شما برای ناموجود شدن در سایت هستند؛ اول آن‌ها را آزاد کنید یا موجودی‌شان را در ERP درست کنید، بعد دوباره بررسی کنید.';
/** Changes waiting this long, with no hold or pause to explain it: the scheduled sends are not running. */
const STALE_QUEUE_MS = 30 * 60_000;

async function isAdmin() {
  const session = await auth();
  return session?.user?.role === 'ADMIN';
}

/** What the browser sent as a list of webIds: anything but an array of strings is refused. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export async function getSiteConnectionForm(): Promise<SiteConnectionForm> {
  if (!(await isAdmin())) throw new Error('Unauthorized');

  const [connection, accounts, warehouses, lastSyncRow] = await Promise.all([
    readSiteConnection(prisma),
    // Money accounts only: EXPENSE-type accounts are P&L buckets.
    prisma.account.findMany({
      where: { type: { not: 'EXPENSE' } },
      select: { id: true, name: true, currency: true },
      orderBy: { name: 'asc' },
    }),
    prisma.warehouse.findMany({
      where: { isArchived: false, isVirtual: false },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.systemSetting.findUnique({ where: { key: SITE_CATALOGUE_SYNC_KEY } }),
  ]);

  let lastSync: CatalogueSyncResult | null = null;
  try {
    lastSync = lastSyncRow?.value ? JSON.parse(lastSyncRow.value) : null;
  } catch {
    lastSync = null;
  }

  return {
    siteUrl: connection.siteUrl ?? '',
    hasSecret: !!connection.webhookSecret,
    paymentAccountId: pickWithDefault(accounts, connection.paymentAccountId, DEFAULT_PAYMENT_ACCOUNT_NAME),
    warehouseId: pickWithDefault(warehouses, connection.warehouseId, DEFAULT_SITE_WAREHOUSE_NAME),
    accounts,
    warehouses,
    lastSync,
  };
}

export async function saveSiteConnection(input: {
  siteUrl: string;
  webhookSecret: string;
  paymentAccountId: string;
  warehouseId: string;
}): Promise<{ success: boolean; message: string }> {
  if (!(await isAdmin())) return { success: false, message: ADMIN_ONLY };

  const siteUrl = normalizeSiteUrl(input.siteUrl ?? '');
  if (!siteUrl) return { success: false, message: 'آدرس سایت معتبر نیست؛ مثلاً https://api.themoak.com' };

  const current = await readSiteConnection(prisma);
  const typedSecret = input.webhookSecret?.trim();
  // The saved secret only ever goes to the site it was saved for: pointing the
  // connection somewhere else requires typing the secret again.
  if (!typedSecret && current.siteUrl && new URL(current.siteUrl).origin !== new URL(siteUrl).origin) {
    return { success: false, message: 'با تغییر آدرس سایت، رمز وبهوک را دوباره وارد کنید.' };
  }
  // An empty field keeps the saved secret; the page never receives it to refill.
  const webhookSecret = typedSecret || current.webhookSecret;
  if (!webhookSecret) return { success: false, message: 'رمز وبهوک را وارد کنید.' };

  const account = await prisma.account.findUnique({
    where: { id: input.paymentAccountId ?? '' },
    select: { type: true },
  });
  if (!account || account.type === 'EXPENSE') {
    return { success: false, message: 'حساب دریافت پول فروش سایت را از فهرست انتخاب کنید.' };
  }
  const warehouse = await prisma.warehouse.findUnique({
    where: { id: input.warehouseId ?? '' },
    select: { isArchived: true, isVirtual: true },
  });
  if (!warehouse || warehouse.isArchived || warehouse.isVirtual) {
    return { success: false, message: 'انبار سایت را از فهرست انتخاب کنید.' };
  }

  // The stock push was switched on for the site, secret and warehouse the site
  // confirmed; a different one of these has to be checked with the site again.
  const unconfirmed =
    !current.siteUrl ||
    new URL(current.siteUrl).origin !== new URL(siteUrl).origin ||
    webhookSecret !== current.webhookSecret ||
    input.warehouseId !== current.warehouseId;
  const stockPushEnabled = current.stockPushEnabled && !unconfirmed;

  const value = JSON.stringify({
    siteUrl,
    webhookSecret,
    paymentAccountId: input.paymentAccountId,
    warehouseId: input.warehouseId,
    stockPushEnabled,
  });
  await prisma.systemSetting.upsert({
    where: { key: SITE_CONNECTION_KEY },
    update: { value },
    create: { key: SITE_CONNECTION_KEY, value },
  });
  // The settings may be what paused automatic sends: let them run again.
  await clearSiteHookPauseCore();
  revalidatePath('/dashboard/settings/site');
  if (current.stockPushEnabled && !stockPushEnabled) {
    // Nothing is owed to the site while switched off; switching on runs a new preview.
    await clearSiteHookHoldCore();
    return {
      success: true,
      message: 'اتصال سایت ذخیره شد. ارسال موجودی به سایت خاموش شد؛ سایت را دوباره بررسی و روشن کنید.',
    };
  }
  return { success: true, message: 'اتصال سایت ذخیره شد.' };
}

/** Reads the catalogue with the saved address and secret. Writes nothing. */
export async function testSiteConnection(): Promise<{ success: boolean; message: string }> {
  if (!(await isAdmin())) return { success: false, message: ADMIN_ONLY };
  const connection = await readSiteConnection(prisma);
  if (!connection.siteUrl || !connection.webhookSecret) {
    return { success: false, message: 'اول آدرس سایت و رمز وبهوک را ذخیره کنید.' };
  }
  const result = await fetchSiteCatalogue({ siteUrl: connection.siteUrl, secret: connection.webhookSecret });
  if (!result.ok) return { success: false, message: result.message };
  return {
    success: true,
    message: `اتصال برقرار است: ${result.items.length.toLocaleString('fa-IR')} کالا در کاتالوگ سایت.`,
  };
}

export async function syncSiteCatalogue(): Promise<CatalogueSyncResult> {
  if (!(await isAdmin())) return { ok: false, message: ADMIN_ONLY, at: new Date().toISOString() };
  const result = await runCatalogueSync(prisma);
  revalidatePath('/dashboard/settings/site');
  revalidatePath('/dashboard/inventory/products');
  return result;
}

// ── Stock push to the site (src/lib/site-hook.ts) ───────────────────────────

export type SiteHookPanel = {
  enabled: boolean;
  status: SiteHookStatus;
  hold: SiteHookHold | null;
  /** webIds the site refused when last sent, with its reason. */
  skipped: Array<{ webId: string; why: string; at: string | null }>;
  /** Changes not yet accepted by the site, and when the oldest was made. */
  pending: number;
  oldestPendingAt: string | null;
};

type Result = { success: boolean; message: string };

/**
 * Asks the site which warehouse it takes stock for, on the server every time:
 * null when it is the saved one, else why not.
 */
async function siteWarehouseRefusal(connection: SiteConnection): Promise<string | null> {
  if (!connection.siteUrl || !connection.webhookSecret || !connection.warehouseId) {
    return 'اول آدرس سایت، رمز وبهوک و انبار سایت را ذخیره کنید.';
  }
  const ping = await pingSiteCore(connection);
  if (!ping.ok) return ping.message;
  if (ping.warehouse !== connection.warehouseId) {
    return `سایت انبار «${ping.warehouse ?? 'انتخاب‌نشده'}» را انبار خودش می‌داند ولی انبار سایت در ERP «${connection.warehouseId}» است؛ در پنل سایت همین انبار ERP را انتخاب کنید.`;
  }
  return null;
}

/**
 * Previews again and binds it to what the admin was shown: nothing may go out
 * of stock beyond `confirmedGoingOut`. Then approves every frame the fresh
 * preview sends as 0, so the drain does not hold them. null when it may go
 * ahead, else why not; a refusal writes nothing.
 */
async function approvePreview(connection: SiteConnection, confirmedGoingOut: string[]): Promise<string | null> {
  const preview = await previewStockPushCore(connection);
  if (!preview.ok) return preview.message;
  const confirmed = new Set(confirmedGoingOut);
  if (preview.goingOut.some((webId) => !confirmed.has(webId))) return PREVIEW_CHANGED;
  if (!(await approveStockZerosCore([...preview.goingOut, ...preview.zeros]))) return HOLD_WAITING;
  return null;
}

/**
 * Sets the switch, keeping every other saved field. Switching on is refused
 * when the saved address, secret or warehouse are no longer the ones just
 * checked; either way nothing is written over a save made in between.
 */
async function writeStockPushEnabled(enabled: boolean, checked?: SiteConnection): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SITE_CONNECTION_KEY } });
  if (!row) return !enabled;
  let saved: Record<string, unknown>;
  try {
    saved = JSON.parse(row.value);
  } catch {
    return !enabled; // unreadable settings already read as switched off
  }
  if (
    checked &&
    (saved.siteUrl !== checked.siteUrl ||
      saved.webhookSecret !== checked.webhookSecret ||
      saved.warehouseId !== checked.warehouseId)
  ) {
    return false;
  }
  const { count } = await prisma.systemSetting.updateMany({
    where: { key: SITE_CONNECTION_KEY, value: row.value },
    data: { value: JSON.stringify({ ...saved, stockPushEnabled: enabled }) },
  });
  return count === 1;
}

export async function getSiteHookPanel(): Promise<
  { success: false; message: string } | ({ success: true; message: string } & SiteHookPanel)
> {
  if (!(await isAdmin())) return { success: false, message: ADMIN_ONLY };
  const [connection, status, hold, skipped, log] = await Promise.all([
    readSiteConnection(prisma),
    readSiteHookStatusCore(),
    readSiteHookHoldCore(),
    prisma.siteHookState.findMany({
      where: { skipWhy: { not: null } },
      select: { webId: true, skipWhy: true, skipAt: true },
      orderBy: { webId: 'asc' },
    }),
    prisma.siteHookLog.aggregate({ _count: { _all: true }, _min: { createdAt: true } }),
  ]);
  return {
    success: true,
    message: '',
    enabled: connection.stockPushEnabled,
    status,
    hold,
    skipped: skipped.map((s: any) => ({ webId: s.webId, why: s.skipWhy ?? '', at: s.skipAt?.toISOString() ?? null })),
    pending: log._count._all,
    oldestPendingAt: log._min.createdAt?.toISOString() ?? null,
  };
}

/**
 * The stock push alerts for the dashboard banner, read afresh on every call.
 * Nothing for anyone but an admin, and nothing on any error.
 */
export async function getSiteHookAlerts(): Promise<string[]> {
  try {
    if (!(await isAdmin())) return [];
    const [connection, status, hold] = await Promise.all([
      readSiteConnection(prisma),
      readSiteHookStatusCore(),
      readSiteHookHoldCore(),
    ]);
    const now = Date.now();
    const alerts = siteHookAlerts({ enabled: connection.stockPushEnabled, status, hold }, now);
    // A hold or a pause already says why changes wait.
    if (connection.stockPushEnabled && !status.paused && hold?.state !== 'held') {
      const log = await prisma.siteHookLog.aggregate({ _min: { createdAt: true } });
      const oldest = log._min.createdAt?.getTime();
      if (oldest !== undefined && now - oldest > STALE_QUEUE_MS) {
        const minutes = Math.floor((now - oldest) / 60_000);
        const age =
          minutes < 120 ? `${minutes.toLocaleString('fa-IR')} دقیقه` : `${Math.floor(minutes / 60).toLocaleString('fa-IR')} ساعت`;
        alerts.push(`تغییرهای موجودی از ${age} پیش به سایت نرسیده است؛ اجرای خودکار ارسال موجودی را بررسی کنید.`);
      }
    }
    return alerts;
  } catch {
    return [];
  }
}

/** What switching on or a full resync would change on the site, once the site confirms the warehouse. Writes nothing. */
export async function previewStockPush(): Promise<
  | { success: false; message: string }
  | { success: true; message: string; preview: Extract<StockPushPreview, { ok: true }> }
> {
  if (!(await isAdmin())) return { success: false, message: ADMIN_ONLY };
  const connection = await readSiteConnection(prisma);
  const refused = await siteWarehouseRefusal(connection);
  if (refused) return { success: false, message: refused };
  const preview = await previewStockPushCore(connection);
  if (!preview.ok) return { success: false, message: preview.message };
  return { success: true, message: 'سایت انبار را تأیید کرد.', preview };
}

/** `confirmedGoingOut`: the frames the admin's preview showed going out of stock. */
export async function enableStockPush(confirmedGoingOut: string[]): Promise<Result> {
  if (!(await isAdmin())) return { success: false, message: ADMIN_ONLY };
  if (!isStringArray(confirmedGoingOut)) return { success: false, message: INVALID_LIST };
  const connection = await readSiteConnection(prisma);
  const refused = await siteWarehouseRefusal(connection);
  if (refused) return { success: false, message: refused };
  const unapproved = await approvePreview(connection, confirmedGoingOut);
  if (unapproved) return { success: false, message: unapproved };
  if (!(await writeStockPushEnabled(true, connection))) return { success: false, message: CHANGED_MEANWHILE };
  await clearSiteHookPauseCore();
  await enqueueFullResyncCore();
  kickSiteHookCore();
  revalidatePath('/dashboard/settings/site');
  return { success: true, message: 'ارسال موجودی به سایت روشن شد؛ همهٔ موجودی تا چند دقیقه به سایت می‌رسد.' };
}

export async function disableStockPush(): Promise<Result> {
  if (!(await isAdmin())) return { success: false, message: ADMIN_ONLY };
  if (!(await writeStockPushEnabled(false))) return { success: false, message: CHANGED_MEANWHILE };
  // Nothing is owed to the site while switched off; switching on runs a new preview.
  await clearSiteHookHoldCore();
  revalidatePath('/dashboard/settings/site');
  return { success: true, message: 'ارسال موجودی به سایت خاموش شد.' };
}

/** `confirmedGoingOut`: the frames the admin's preview showed going out of stock. */
export async function resyncStockPush(confirmedGoingOut: string[]): Promise<Result> {
  if (!(await isAdmin())) return { success: false, message: ADMIN_ONLY };
  if (!isStringArray(confirmedGoingOut)) return { success: false, message: INVALID_LIST };
  const connection = await readSiteConnection(prisma);
  if (!connection.stockPushEnabled) {
    return { success: false, message: 'ارسال موجودی به سایت خاموش است؛ اول آن را روشن کنید.' };
  }
  const refused = await siteWarehouseRefusal(connection);
  if (refused) return { success: false, message: refused };
  const unapproved = await approvePreview(connection, confirmedGoingOut);
  if (unapproved) return { success: false, message: unapproved };
  await clearSiteHookPauseCore();
  await enqueueFullResyncCore();
  kickSiteHookCore();
  revalidatePath('/dashboard/settings/site');
  return { success: true, message: 'همهٔ موجودی دوباره به سایت فرستاده می‌شود.' };
}

/** `shown`: the held webIds the admin was shown; a hold that changed since is refused. */
export async function releaseStockHold(shown: string[]): Promise<Result> {
  if (!(await isAdmin())) return { success: false, message: ADMIN_ONLY };
  if (!isStringArray(shown) || !(await releaseSiteHookHoldCore(shown))) {
    return { success: false, message: 'فهرست نگه‌داشته تغییر کرده؛ صفحه را تازه کنید.' };
  }
  kickSiteHookCore();
  revalidatePath('/dashboard/settings/site');
  return { success: true, message: 'آزاد شد؛ با ارسال بعدی، موجودی فعلی این فریم‌ها در ERP به سایت فرستاده می‌شود.' };
}

export async function retryStockPush(): Promise<Result> {
  if (!(await isAdmin())) return { success: false, message: ADMIN_ONLY };
  await clearSiteHookPauseCore();
  kickSiteHookCore();
  revalidatePath('/dashboard/settings/site');
  return { success: true, message: 'ارسال موجودی با اجرای بعدی دوباره امتحان می‌شود.' };
}
