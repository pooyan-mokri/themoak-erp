
'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { Role } from '@prisma/client';

export async function getSetting(key: string) {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key },
    });
    return setting?.value ? JSON.parse(setting.value) : undefined;
  } catch (error) {
    console.error(`Error fetching setting ${key}:`, error);
    return undefined;
  }
}

export async function saveSetting(key: string, value: any) {
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

export async function getWooSettings() {
  return await getSetting('woo_settings');
}

// Default to https — an http URL that redirects to https makes the server drop the
// Authorization header, which WooCommerce reports as an invalid Consumer Key/Secret.
function normalizeWooUrl(raw: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export async function saveWooSettings(settings: {
  url: string;
  consumerKey: string;
  consumerSecret: string;
  warehouseId?: string;
  accountId?: string;
}) {
  const session = await auth();

  if (!session?.user) {
    return { success: false, error: 'لطفاً وارد سیستم شوید.' };
  }

  if (session.user.role !== Role.ADMIN) {
    return { success: false, error: 'شما مجوز دسترسی به تنظیمات ووکامرس را ندارید.' };
  }

  // Trim credentials — a stray leading/trailing space in a pasted key is a
  // common cause of WooCommerce returning 401 "invalid Consumer Key/Secret".
  return await saveSetting('woo_settings', {
    ...settings,
    url: normalizeWooUrl(settings.url),
    consumerKey: settings.consumerKey?.trim(),
    consumerSecret: settings.consumerSecret?.trim(),
  });
}
