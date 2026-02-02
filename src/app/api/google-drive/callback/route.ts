import { NextRequest, NextResponse } from 'next/server';
import { saveSetting, getSetting } from '@/actions/settings';
import { auth } from '@/auth';
import { Role } from '@prisma/client';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    // Check if user is admin
    if (!session?.user || session.user.role !== Role.ADMIN) {
      return NextResponse.redirect(
        new URL('/dashboard/settings?error=unauthorized', request.url)
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error) {
      return NextResponse.redirect(
        new URL('/dashboard/settings?error=access_denied', request.url)
      );
    }

    if (!code) {
      return NextResponse.redirect(
        new URL('/dashboard/settings?error=no_code', request.url)
      );
    }

    // Get OAuth credentials from settings
    const oauthCreds = (await getSetting('google_drive_oauth_credentials')) as
      | { clientId: string; clientSecret: string }
      | undefined;

    if (!oauthCreds?.clientId || !oauthCreds?.clientSecret) {
      console.error('Missing Google Drive OAuth credentials in settings');
      return NextResponse.redirect(
        new URL('/dashboard/settings?error=missing_oauth_creds', request.url)
      );
    }

    const { google } = await import('googleapis');
    
    // Determine redirect URI - prioritize explicit setting, then Vercel URL, then AUTH_URL/NEXTAUTH_URL
    const getRedirectUri = () => {
      if (process.env.GOOGLE_REDIRECT_URI) {
        return process.env.GOOGLE_REDIRECT_URI;
      }
      
      // Vercel automatically provides VERCEL_URL
      if (process.env.VERCEL_URL) {
        return `https://${process.env.VERCEL_URL}/api/google-drive/callback`;
      }
      
      // Use AUTH_URL or NEXTAUTH_URL if available
      const baseUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
      if (baseUrl) {
        return `${baseUrl}/api/google-drive/callback`;
      }
      
      // Fallback to localhost for development
      return 'http://localhost:3000/api/google-drive/callback';
    };
    
    const oauth2Client = new google.auth.OAuth2(
      oauthCreds.clientId,
      oauthCreds.clientSecret,
      getRedirectUri()
    );

    const { tokens } = await oauth2Client.getToken(code);

    // Save credentials
    await saveSetting('google_drive_credentials', {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
      token_type: tokens.token_type || 'Bearer',
    });

    return NextResponse.redirect(
      new URL('/dashboard/settings?success=google_drive_connected', request.url)
    );
  } catch (error) {
    console.error('Google Drive callback error:', error);
    return NextResponse.redirect(
      new URL('/dashboard/settings?error=connection_failed', request.url)
    );
  }
}
