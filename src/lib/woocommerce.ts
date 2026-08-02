import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import { getSetting } from '@/actions/settings';

// Normalise a URL or bare IP/hostname so WooCommerceRestApi always receives a proper URL.
// Default to https: an http URL that redirects to https makes the server drop the
// Authorization header, which WooCommerce then reports as invalid Consumer Key/Secret.
function normalizeWooUrl(raw: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

// Function to get WooCommerce client with settings from database
export async function getWooCommerceClient() {
  const wooSettings = await getSetting('woo_settings');

  // Fallback to environment variables if settings not found in database
  const rawUrl = (wooSettings?.url || process.env.WOOCOMMERCE_URL || '').trim();
  const consumerKey = (wooSettings?.consumerKey || process.env.WOOCOMMERCE_CONSUMER_KEY || '').trim();
  const consumerSecret = (wooSettings?.consumerSecret || process.env.WOOCOMMERCE_CONSUMER_SECRET || '').trim();

  if (!rawUrl) {
    throw new Error('تنظیمات WooCommerce یافت نشد. لطفا در بخش تنظیمات، اطلاعات WooCommerce را وارد کنید.');
  }

  // Never fall back to placeholder keys — doing so surfaces a misleading
  // "invalid Consumer Key/Secret" 401 instead of "credentials not configured".
  if (!consumerKey || !consumerSecret) {
    throw new Error('کلیدهای WooCommerce ثبت نشده‌اند. لطفا در تنظیمات → ووکامرس، Consumer Key و Consumer Secret را وارد و ذخیره کنید.');
  }

  return new WooCommerceRestApi({
    url: normalizeWooUrl(rawUrl),
    consumerKey,
    consumerSecret,
    version: "wc/v3",
  });
}

// Legacy default export for backward compatibility (uses env vars only)
const wooCommerce = new WooCommerceRestApi({
  url: process.env.WOOCOMMERCE_URL || "https://example.com",
  consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY || "ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET || "cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  version: "wc/v3",
});

export default wooCommerce;
