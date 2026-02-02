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
 * Get Google Drive OAuth2 client
 */
export async function getGoogleDriveClient() {
  const credentials = (await getSetting('google_drive_credentials')) as
    | GoogleDriveCredentials
    | undefined;

  if (!credentials) {
    throw new Error('Google Drive not connected. Please connect in settings.');
  }

  const google = await getGoogleAuth();
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ||
      `${
        process.env.AUTH_URL ||
        process.env.NEXTAUTH_URL ||
        'http://localhost:3000'
      }/api/google-drive/callback`
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
  const google = await getGoogleAuth();
  const drive = await getGoogleDriveClient();

  // Get or create folder for receipts
  const folderName = 'Themoak ERP Receipts';
  let folderId = (await getSetting('google_drive_folder_id')) as
    | string
    | undefined;

  if (!folderId) {
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
  }

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

  // Make file publicly viewable (or you can use service account with domain-wide delegation)
  await drive.permissions.create({
    fileId: response.data.id!,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  return {
    fileId: response.data.id!,
    webViewLink: response.data.webViewLink || '',
    webContentLink: response.data.webContentLink || '',
  };
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
  const google = await getGoogleAuth();
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI ||
      `${
        process.env.AUTH_URL ||
        process.env.NEXTAUTH_URL ||
        'http://localhost:3000'
      }/api/google-drive/callback`
  );

  const scopes = [
    'https://www.googleapis.com/auth/drive.file', // Access to files created by the app
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent', // Force consent to get refresh token
  });
}
