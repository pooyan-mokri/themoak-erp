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

/** The hosts whose photos Next.js's image route may fetch, over https: images.remotePatterns in next.config.js. */
export const PHOTO_HOSTS = ['themoak.com'];

/**
 * A product's photo at an address on this site, for a page that draws it into a canvas or a 3D scene, which a
 * photo from another site sent without CORS headers cannot be. The website's photo first, else the one uploaded
 * here, as every screen shows them (product-photo.tsx): an uploaded photo is on this site already; the website's
 * is read through Next.js's image route (/_next/image, 384 px wide), which may fetch from PHOTO_HOSTS. Null when
 * the product has no photo, or only one on another host.
 */
export function productPhotoOnSite(product: { imageUrl?: string | null; image?: string | null }): string | null {
  for (const url of [product.imageUrl, product.image]) {
    if (!url) continue;
    if (url.startsWith('/') && !url.startsWith('//')) return url;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' && PHOTO_HOSTS.includes(parsed.hostname)) {
        return `/_next/image?url=${encodeURIComponent(url)}&w=384&q=75`;
      }
    } catch {
      // Not an address: try the other photo.
    }
  }
  return null;
}
