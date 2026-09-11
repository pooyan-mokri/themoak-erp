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
  type SiteConnectionForm,
} from '@/lib/site-connection';
import { fetchSiteCatalogue, type CatalogueSyncResult } from '@/lib/site-catalogue';
import { runCatalogueSync } from '@/lib/site-catalogue-sync';

const ADMIN_ONLY = 'فقط مدیر سیستم می‌تواند اتصال سایت را مدیریت کند.';

async function isAdmin() {
  const session = await auth();
  return session?.user?.role === 'ADMIN';
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

  const value = JSON.stringify({
    siteUrl,
    webhookSecret,
    paymentAccountId: input.paymentAccountId,
    warehouseId: input.warehouseId,
  });
  await prisma.systemSetting.upsert({
    where: { key: SITE_CONNECTION_KEY },
    update: { value },
    create: { key: SITE_CONNECTION_KEY, value },
  });
  revalidatePath('/dashboard/settings/site');
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
