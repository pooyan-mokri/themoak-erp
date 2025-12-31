'use server';

import prisma from '@/lib/db';

export interface WooCommerceAutoSyncSettings {
  enabled: boolean;
  intervalMinutes: number;
  lastSyncAt?: Date;
}

const AUTO_SYNC_ENABLED_KEY = 'woocommerce_auto_sync_enabled';
const AUTO_SYNC_INTERVAL_KEY = 'woocommerce_auto_sync_interval';
const AUTO_SYNC_LAST_SYNC_KEY = 'woocommerce_auto_sync_last_sync';

/**
 * دریافت تنظیمات سینک خودکار WooCommerce
 */
export async function getAutoSyncSettings(): Promise<WooCommerceAutoSyncSettings> {
  try {
    const enabledSetting = await prisma.systemSetting.findUnique({
      where: { key: AUTO_SYNC_ENABLED_KEY },
    });

    const intervalSetting = await prisma.systemSetting.findUnique({
      where: { key: AUTO_SYNC_INTERVAL_KEY },
    });

    const lastSyncSetting = await prisma.systemSetting.findUnique({
      where: { key: AUTO_SYNC_LAST_SYNC_KEY },
    });

    return {
      enabled: enabledSetting?.value === 'true',
      intervalMinutes: intervalSetting ? parseInt(intervalSetting.value) : 60,
      lastSyncAt: lastSyncSetting ? new Date(lastSyncSetting.value) : undefined,
    };
  } catch (error) {
    console.error('Error getting auto-sync settings:', error);
    return {
      enabled: false,
      intervalMinutes: 60,
    };
  }
}

/**
 * تنظیم settings برای سینک خودکار WooCommerce
 */
export async function setAutoSyncSettings(settings: {
  enabled: boolean;
  intervalMinutes: number;
}): Promise<{ success: boolean; message: string }> {
  try {
    // Validate interval
    if (settings.intervalMinutes < 5) {
      return {
        success: false,
        message: 'بازه زمانی باید حداقل 5 دقیقه باشد.',
      };
    }

    // Update or create enabled setting
    await prisma.systemSetting.upsert({
      where: { key: AUTO_SYNC_ENABLED_KEY },
      update: { value: settings.enabled.toString() },
      create: { key: AUTO_SYNC_ENABLED_KEY, value: settings.enabled.toString() },
    });

    // Update or create interval setting
    await prisma.systemSetting.upsert({
      where: { key: AUTO_SYNC_INTERVAL_KEY },
      update: { value: settings.intervalMinutes.toString() },
      create: { key: AUTO_SYNC_INTERVAL_KEY, value: settings.intervalMinutes.toString() },
    });

    return {
      success: true,
      message: 'تنظیمات سینک خودکار با موفقیت ذخیره شد.',
    };
  } catch (error) {
    console.error('Error setting auto-sync settings:', error);
    return {
      success: false,
      message: 'خطا در ذخیره تنظیمات.',
    };
  }
}

/**
 * به‌روزرسانی زمان آخرین سینک
 */
export async function updateLastSyncTime(): Promise<void> {
  try {
    await prisma.systemSetting.upsert({
      where: { key: AUTO_SYNC_LAST_SYNC_KEY },
      update: { value: new Date().toISOString() },
      create: { key: AUTO_SYNC_LAST_SYNC_KEY, value: new Date().toISOString() },
    });
  } catch (error) {
    console.error('Error updating last sync time:', error);
  }
}
