import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { runCatalogueSync } from '@/lib/site-catalogue-sync';

export const dynamic = 'force-dynamic';
// One catalogue read plus up to one small write per product.
export const maxDuration = 60;

/**
 * Daily photo sync from the website's catalogue, scheduled in vercel.json.
 * Vercel sends `Authorization: Bearer $CRON_SECRET`. With that env var unset,
 * every call is refused rather than falling back to a guessable key.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
  }
  const result = await runCatalogueSync(prisma);
  return NextResponse.json(result);
}
