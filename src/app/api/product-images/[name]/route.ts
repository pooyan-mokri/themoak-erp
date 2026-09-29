import { NextRequest, NextResponse } from 'next/server';
import { getCurrentRole } from '@/lib/access';
import { isProductImageName } from '@/lib/product-image';
import { PRODUCT_IMAGE_TYPES, readProductImage } from '@/lib/product-image-storage';
import { sniffReceiptType } from '@/lib/receipt-storage';

// Session-dependent: never cached or prerendered.
export const dynamic = 'force-dynamic';

/** Streams a product photo uploaded in the ERP (src/lib/product-image-storage.ts) to a signed-in user. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  if (!(await getCurrentRole())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { name } = await params;
  if (!isProductImageName(name)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let bytes: Buffer | null;
  try {
    bytes = await readProductImage(name);
  } catch (error) {
    console.error('[Product images] read:', error);
    return new NextResponse('دسترسی به سرور FTP ممکن نشد؛ کمی بعد دوباره امتحان کنید.', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  if (!bytes) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Typed by its bytes, which the upload checked; the name says the same.
  const type = sniffReceiptType(bytes);
  const expected = PRODUCT_IMAGE_TYPES[name.split('.').pop() as keyof typeof PRODUCT_IMAGE_TYPES];
  if (type !== expected) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': type,
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      // A name is never reused for other bytes.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
