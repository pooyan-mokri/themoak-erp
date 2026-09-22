import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentRole } from '@/lib/access';
import { isReceiptRef, mayViewReceipt } from '@/lib/receipt-ref';
import { readReceipt, sniffReceiptType } from '@/lib/receipt-storage';

// Session-dependent: never cached or prerendered.
export const dynamic = 'force-dynamic';

/** Streams a stored receipt to someone who may see the row it is attached to. */
export async function GET(request: NextRequest) {
  const role = await getCurrentRole();
  if (!role) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ref = request.nextUrl.searchParams.get('ref');
  if (!isReceiptRef(ref)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const row = await prisma.transaction.findFirst({
    where: { receiptUrl: ref },
    select: { type: true, orderId: true },
  });
  if (!mayViewReceipt(role, row)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let bytes: Buffer | null;
  try {
    bytes = await readReceipt(ref);
  } catch (error) {
    console.error('[Receipts] read:', error);
    return new NextResponse('دسترسی به سرور FTP رسیدها ممکن نشد؛ کمی بعد دوباره امتحان کنید.', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  if (!bytes) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // Typed by its bytes: an older file of another kind downloads instead of opening.
  const type = sniffReceiptType(bytes);

  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': type ?? 'application/octet-stream',
      'Content-Disposition': type ? 'inline' : 'attachment',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
