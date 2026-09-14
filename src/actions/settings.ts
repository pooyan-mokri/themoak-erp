
'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { Role } from '@prisma/client';
import { SITE_SETTING_KEYS } from '@/lib/site-connection';

export async function getSetting(key: string) {
  // These actions are imported by a client component, so they are reachable
  // from the browser with no session check. The site connection holds the
  // webhook secret and has its own admin-only actions: never serve it here.
  if (SITE_SETTING_KEYS.includes(key)) return undefined;
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key },
    });
    const value = setting?.value ? JSON.parse(setting.value) : undefined;
    // The WooCommerce store is gone: its url and keys are never served.
    return key === 'woo_settings' && value ? withoutWooConnection(value) : value;
  } catch (error) {
    console.error(`Error fetching setting ${key}:`, error);
    return undefined;
  }
}

export async function saveSetting(key: string, value: any) {
  if (SITE_SETTING_KEYS.includes(key)) {
    return { success: false, error: 'This setting can only be changed from its own settings page' };
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
