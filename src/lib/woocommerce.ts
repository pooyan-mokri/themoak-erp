import WooCommerceRestApi from "@woocommerce/woocommerce-rest-api";
import { getSetting } from '@/actions/settings';

// Normalise a URL or bare IP/hostname so WooCommerceRestApi always receives a proper URL
function normalizeWooUrl(raw: string): string {
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `http://${raw}`;
}

// Function to get WooCommerce client with settings from database
export async function getWooCommerceClient() {
  const wooSettings = await getSetting('woo_settings');

  // Fallback to environment variables if settings not found in database
  const rawUrl = wooSettings?.url || process.env.WOOCOMMERCE_URL || "https://example.com";
  const url = normalizeWooUrl(rawUrl);
  const consumerKey = wooSettings?.consumerKey || process.env.WOOCOMMERCE_CONSUMER_KEY || "ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
  const consumerSecret = wooSettings?.consumerSecret || process.env.WOOCOMMERCE_CONSUMER_SECRET || "cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

  if (!wooSettings?.url && !process.env.WOOCOMMERCE_URL) {
    throw new Error('تنظیمات WooCommerce یافت نشد. لطفا در بخش تنظیمات، اطلاعات WooCommerce را وارد کنید.');
  }

  return new WooCommerceRestApi({
    url,
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
