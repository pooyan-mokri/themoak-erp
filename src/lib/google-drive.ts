'use server';

import { getSetting } from '@/actions/settings';

// Dynamic import to avoid issues if googleapis is not installed
async function getGoogleAuth() {
  const { google } = await import('googleapis');
  return google;
}

interface GoogleDriveCredentials {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  token_type: string;
}

/**
 * Get the redirect URI for OAuth callback
 * Prioritizes explicit setting, then Vercel URL, then AUTH_URL/NEXTAUTH_URL
 */
function getRedirectUri(): string {
  if (process.env.GOOGLE_REDIRECT_URI) {
    console.log(
      '[Google Drive] Using GOOGLE_REDIRECT_URI:',
      process.env.GOOGLE_REDIRECT_URI
    );
    return process.env.GOOGLE_REDIRECT_URI;
  }

  // Vercel automatically provides VERCEL_URL (but it might be the preview URL, not custom domain)
  if (process.env.VERCEL_URL) {
    const uri = `https://${process.env.VERCEL_URL}/api/google-drive/callback`;
    console.log('[Google Drive] Using VERCEL_URL:', uri);
    return uri;
  }

  // Use AUTH_URL or NEXTAUTH_URL if available
  const baseUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (baseUrl) {
    const uri = `${baseUrl}/api/google-drive/callback`;
    console.log('[Google Drive] Using AUTH_URL/NEXTAUTH_URL:', uri);
    return uri;
  }

  // Fallback to localhost for development
  const fallback = 'http://localhost:3000/api/google-drive/callback';
  console.log('[Google Drive] Using fallback:', fallback);
  return fallback;
}

/**
 * Get Google Drive OAuth2 client
 */
export async function getGoogleDriveClient() {
  const credentials = (await getSetting('google_drive_credentials')) as
    | GoogleDriveCredentials
    | undefined;

  if (!credentials) {
    throw new Error('Google Drive not connected. Please connect in settings.');
  }

  // Get OAuth credentials from settings
  const oauthCreds = (await getSetting('google_drive_oauth_credentials')) as
    | { clientId: string; clientSecret: string }
    | undefined;

  if (!oauthCreds?.clientId || !oauthCreds?.clientSecret) {
    throw new Error(
      'Google Drive OAuth credentials not configured. Please set Client ID and Client Secret in settings.'
    );
  }

  const google = await getGoogleAuth();
  const oauth2Client = new google.auth.OAuth2(
    oauthCreds.clientId,
    oauthCreds.clientSecret,
    getRedirectUri()
  );

  oauth2Client.setCredentials({
    access_token: credentials.access_token,
    refresh_token: credentials.refresh_token,
    expiry_date: credentials.expiry_date,
  });

  // Refresh token if expired
  if (credentials.expiry_date && credentials.expiry_date <= Date.now()) {
    try {
      const { credentials: newCredentials } =
        await oauth2Client.refreshAccessToken();
      // Update stored credentials
      const { saveSetting } = await import('@/actions/settings');
      await saveSetting('google_drive_credentials', {
        ...credentials,
        access_token: newCredentials.access_token,
        expiry_date: newCredentials.expiry_date,
      });
      oauth2Client.setCredentials(newCredentials);
    } catch (error) {
      console.error('Error refreshing Google Drive token:', error);
      throw new Error(
        'Failed to refresh Google Drive token. Please reconnect.'
      );
    }
  }

  return google.drive({ version: 'v3', auth: oauth2Client });
}

/**
 * Upload file to Google Drive
 */
export async function uploadToGoogleDrive(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<{ fileId: string; webViewLink: string; webContentLink: string }> {
  try {
    const google = await getGoogleAuth();
    const drive = await getGoogleDriveClient();

    // Get or create folder for receipts
    const folderName = 'Themoak ERP Receipts';
    let folderId = (await getSetting('google_drive_folder_id')) as
      | string
      | undefined;

    if (!folderId) {
      console.log('[Google Drive] Creating folder:', folderName);
      try {
        // Create folder
        const folderResponse = await drive.files.create({
          requestBody: {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
          },
          fields: 'id',
        });

        folderId = folderResponse.data.id!;
        const { saveSetting } = await import('@/actions/settings');
        await saveSetting('google_drive_folder_id', folderId);
        console.log('[Google Drive] Folder created:', folderId);
      } catch (error: any) {
        console.error('[Google Drive] Error creating folder:', error);
        throw new Error(`Failed to create folder: ${error?.message || 'Unknown error'}`);
      }
    }

    console.log('[Google Drive] Uploading file:', fileName, 'to folder:', folderId);

    // Upload file
    const fileMetadata = {
      name: fileName,
      parents: [folderId],
    };

    const media = {
      mimeType,
      body: Buffer.from(fileBuffer),
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink, webContentLink',
    });

    if (!response.data.id) {
      throw new Error('File uploaded but no file ID returned');
    }

    console.log('[Google Drive] File uploaded successfully:', response.data.id);

    // Make file publicly viewable (or you can use service account with domain-wide delegation)
    try {
      await drive.permissions.create({
        fileId: response.data.id,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });
      console.log('[Google Drive] File permissions set');
    } catch (permError: any) {
      console.warn('[Google Drive] Warning: Could not set file permissions:', permError?.message);
      // Don't fail the upload if permissions fail
    }

    return {
      fileId: response.data.id,
      webViewLink: response.data.webViewLink || '',
      webContentLink: response.data.webContentLink || '',
    };
  } catch (error: any) {
    console.error('[Google Drive] Upload error details:', {
      message: error?.message,
      code: error?.code,
      status: error?.response?.status,
      statusText: error?.response?.statusText,
      errors: error?.errors,
    });
    
    // Provide more specific error messages
    if (error?.code === 401 || error?.message?.includes('invalid_grant')) {
      throw new Error('Google Drive authentication expired. Please reconnect in settings.');
    }
    if (error?.code === 403 || error?.message?.includes('permission')) {
      throw new Error('Permission denied. Please check Google Drive API permissions.');
    }
    if (error?.code === 404) {
      throw new Error('Folder not found. Please reconnect Google Drive.');
    }
    
    throw new Error(error?.message || 'Failed to upload to Google Drive');
  }
}

/**
 * Delete file from Google Drive
 */
export async function deleteFromGoogleDrive(fileId: string): Promise<void> {
  const drive = await getGoogleDriveClient();
  await drive.files.delete({ fileId });
}

/**
 * Get Google Drive OAuth URL
 */
export async function getGoogleDriveAuthUrl(): Promise<string> {
  // Get OAuth credentials from settings
  const oauthCreds = (await getSetting('google_drive_oauth_credentials')) as
    | { clientId: string; clientSecret: string }
    | undefined;

  if (!oauthCreds?.clientId || !oauthCreds?.clientSecret) {
    throw new Error(
      'Google Drive OAuth credentials not configured. Please set Client ID and Client Secret in settings.'
    );
  }

  const google = await getGoogleAuth();
  const oauth2Client = new google.auth.OAuth2(
    oauthCreds.clientId,
    oauthCreds.clientSecret,
    getRedirectUri()
  );

  const scopes = [
    'https://www.googleapis.com/auth/drive.file', // Access to files created by the app
  ];

  const redirectUri = getRedirectUri();
  console.log(
    '[Google Drive] Generating auth URL with redirect URI:',
    redirectUri
  );

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent', // Force consent to get refresh token
  });
}
