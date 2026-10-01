/**
 * Product photos uploaded in the ERP live on the FTP server set in Settings
 * (src/lib/product-image-storage.ts) and are served by /api/product-images.
 * Photos uploaded before that stay in public/uploads/products. Pure, so the
 * image components share it.
 */
export const PRODUCT_IMAGE_ROUTE = '/api/product-images/';

const NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

/** The stored file's name: <uuid>.<ext>, the only names the upload makes. */
export function isProductImageName(name: unknown): name is string {
  return typeof name === 'string' && NAME.test(name);
}

/** The name of a photo served by the route, or null for any other address. */
export function productImageName(url: string): string | null {
  if (!url.startsWith(PRODUCT_IMAGE_ROUTE)) return null;
  const name = url.slice(PRODUCT_IMAGE_ROUTE.length);
  return isProductImageName(name) ? name : null;
}
