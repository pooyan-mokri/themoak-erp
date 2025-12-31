import { NextRequest, NextResponse } from 'next/server';
import { getAutoSyncSettings } from '@/actions/woocommerce-settings';
import { performAutoSync } from '@/actions/woocommerce';

/**
 * API Route برای سینک خودکار WooCommerce
 * این route توسط cron job صدا زده می‌شود
 *
 * استفاده:
 * GET /api/woocommerce/auto-sync?key=YOUR_CRON_SECRET_KEY
 */
export async function GET(request: NextRequest) {
  try {
    // 1. Check authorization (simple secret key check)
    const searchParams = request.nextUrl.searchParams;
    const providedKey = searchParams.get('key');
    const expectedKey = process.env.CRON_SECRET_KEY || 'your-secret-key-here';

    if (providedKey !== expectedKey) {
      console.error('[AUTO-SYNC API] Unauthorized access attempt');
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Get auto-sync settings
    const settings = await getAutoSyncSettings();

    if (!settings.enabled) {
      console.log('[AUTO-SYNC API] Auto-sync is disabled');
      return NextResponse.json({
        success: false,
        message: 'Auto-sync is disabled',
      });
    }

    // 3. Check if enough time has passed since last sync
    if (settings.lastSyncAt) {
      const now = new Date();
      const lastSync = new Date(settings.lastSyncAt);
      const minutesSinceLastSync = (now.getTime() - lastSync.getTime()) / 1000 / 60;

      if (minutesSinceLastSync < settings.intervalMinutes) {
        const remainingMinutes = Math.ceil(settings.intervalMinutes - minutesSinceLastSync);
        console.log(`[AUTO-SYNC API] Too soon to sync. ${remainingMinutes} minutes remaining.`);
        return NextResponse.json({
          success: false,
          message: `Too soon to sync. Wait ${remainingMinutes} more minutes.`,
          data: {
            lastSyncAt: settings.lastSyncAt,
            intervalMinutes: settings.intervalMinutes,
            minutesSinceLastSync: Math.floor(minutesSinceLastSync),
          },
        });
      }
    }

    // 4. Perform auto-sync
    console.log('[AUTO-SYNC API] Starting auto-sync...');
    const result = await performAutoSync();

    console.log('[AUTO-SYNC API] Auto-sync completed:', {
      success: result.success,
      message: result.message,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[AUTO-SYNC API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Error: ${error.message || 'Unknown error'}`,
      },
      { status: 500 }
    );
  }
}
