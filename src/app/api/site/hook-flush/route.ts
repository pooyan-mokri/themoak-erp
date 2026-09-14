import { NextRequest, NextResponse } from 'next/server';
import { drainSiteHook } from '@/lib/site-hook';

export const dynamic = 'force-dynamic';
// One drain: sends start for up to 25 s and each may take 30 s to answer.
export const maxDuration = 60;

/**
 * Called every 1-2 minutes by an external scheduler, so a stock change reaches
 * the website even when nothing else in the ERP happens after it.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(await drainSiteHook({ deadlineMs: 25_000 }));
}

export const GET = handle;
export const POST = handle;
