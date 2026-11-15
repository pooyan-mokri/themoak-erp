import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { CONNECTOR_FILE_NAME, CONNECTOR_SERVER, CONNECTOR_SERVER_FILE_NAME, connectorBundle, erpAddress } from '@/lib/connector-bundle';

export const dynamic = 'force-dynamic';

/**
 * The connector for Claude Desktop, to download (the «کلیدهای Claude» dialog in تنظیمات ← کاربران):
 *
 *   GET /api/connector               the bundle Claude Desktop installs, macOS and Windows alike (.mcpb)
 *   GET /api/connector?file=server   the server file alone, for an install by hand
 *
 * For anyone signed in. The file holds no key and no data: the person installing it enters their own key.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const alone = request.nextUrl.searchParams.get('file') === 'server';
  const body = alone ? Buffer.from(CONNECTOR_SERVER, 'utf8') : connectorBundle(erpAddress(request));
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'content-type': alone ? 'text/javascript; charset=utf-8' : 'application/octet-stream',
      'content-disposition': `attachment; filename="${alone ? CONNECTOR_SERVER_FILE_NAME : CONNECTOR_FILE_NAME}"`,
      'content-length': String(body.length),
      'cache-control': 'no-store',
    },
  });
}
