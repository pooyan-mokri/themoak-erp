
'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { Role } from '@prisma/client';
import { SITE_SETTING_KEYS } from '@/lib/site-connection';
import { readSystemSetting } from '@/lib/system-settings';

/** The logo and the invoice header: every signed-in user needs them. Every other key is for an admin only. */
const SIGNED_IN_SETTING_KEYS = ['company_info'];

export async function getSetting(key: string) {
  // These actions are imported by a client component, so they are reachable
  // from the browser. The site connection holds the webhook secret and has its
  // own admin-only actions: never serve it here.
  if (SITE_SETTING_KEYS.includes(key)) return undefined;
  // Server code that needs another key (the FTP password) uses readSystemSetting.
  const session = await auth();
  if (!session?.user) return undefined;
  if (!SIGNED_IN_SETTING_KEYS.includes(key) && session.user.role !== Role.ADMIN) return undefined;
  const value = await readSystemSetting(key);
  // The WooCommerce store is gone: its url and keys are never served.
  return key === 'woo_settings' && value ? withoutWooConnection(value) : value;
}

export async function saveSetting(key: string, value: any) {
  if (SITE_SETTING_KEYS.includes(key)) {
    return { success: false, error: 'This setting can only be changed from its own settings page' };
  }
  const session = await auth();
  if (!session?.user || session.user.role !== Role.ADMIN) {
    return { success: false, error: 'شما مجوز دسترسی به این تنظیمات را ندارید.' };
  }
  try {
    await prisma.systemSetting.upsert({
      where: { key },
      update: { value: JSON.stringify(value) },
      create: { key, value: JSON.stringify(value) },
    });
    revalidatePath('/dashboard/settings');
    return { success: true };
  } catch (error) {
    console.error(`Error saving setting ${key}:`, error);
    return { success: false, error: 'Failed to save setting' };
  }
}

export async function getCompanyInfo() {
  return await getSetting('company_info');
}

export async function saveCompanyInfo(info: {
  name: string;
  phone: string;
  address: string;
  logo?: string; // Base64 string
}) {
  const session = await auth();
  
  if (!session?.user) {
    return { success: false, error: 'لطفاً وارد سیستم شوید.' };
  }

  if (session.user.role !== Role.ADMIN) {
    return { success: false, error: 'شما مجوز دسترسی به تنظیمات شرکت را ندارید.' };
  }

  return await saveSetting('company_info', info);
}

/** Fields of the retired WooCommerce connection: never served, and dropped on the next save. */
const WOO_CONNECTION_FIELDS = ['url', 'consumerKey', 'consumerSecret'];

function withoutWooConnection(woo: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(woo).filter(([field]) => !WOO_CONNECTION_FIELDS.includes(field)));
}

/** The settings card only picks the default warehouse cancelled stock returns to. */
export async function getWooSettings(): Promise<{ warehouseId?: string }> {
  const woo = await getSetting('woo_settings');
  return { warehouseId: woo?.warehouseId };
}

export async function saveWooSettings(settings: { warehouseId?: string }) {
  const session = await auth();

  if (!session?.user) {
    return { success: false, error: 'لطفاً وارد سیستم شوید.' };
  }

  if (session.user.role !== Role.ADMIN) {
    return { success: false, error: 'شما مجوز دسترسی به این تنظیمات را ندارید.' };
  }

  // Only the warehouse comes from the card; every other stored key is written back as stored.
  let woo: Record<string, unknown>;
  try {
    const stored = await prisma.systemSetting.findUnique({ where: { key: 'woo_settings' } });
    woo = stored?.value ? withoutWooConnection(JSON.parse(stored.value)) : {};
  } catch (error) {
    console.error('Error reading setting woo_settings:', error);
    return { success: false, error: 'Failed to save setting' };
  }
  return await saveSetting('woo_settings', { ...woo, warehouseId: settings.warehouseId });
}
