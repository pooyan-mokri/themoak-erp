'use server';

import {
  getGoogleDriveAuthUrl,
  getGoogleDriveClient,
} from '@/lib/google-drive';
import { getSetting, saveSetting } from './settings';
import { auth } from '@/auth';
import { Role } from '@prisma/client';

export async function getGoogleDriveAuthUrlAction() {
  const session = await auth();

  if (!session?.user || session.user.role !== Role.ADMIN) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    const url = await getGoogleDriveAuthUrl();
    return { success: true, url };
  } catch (error: any) {
    console.error('Error generating Google Drive auth URL:', error);
    const errorMessage = error?.message || 'Failed to generate auth URL';

    // Provide helpful error messages
    if (errorMessage.includes('OAuth credentials not configured')) {
      return {
        success: false,
        error:
          'لطفاً ابتدا Client ID و Client Secret را در فرم بالا وارد و ذخیره کنید.',
      };
    }

    return { success: false, error: errorMessage };
  }
}

export async function getGoogleDriveStatus() {
  const session = await auth();

  if (!session?.user || session.user.role !== Role.ADMIN) {
    return { connected: false };
  }

  try {
    const credentials = await getSetting('google_drive_credentials');
    const folderId = await getSetting('google_drive_folder_id');

    if (credentials) {
      // Test connection
      const drive = await getGoogleDriveClient();
      await drive.about.get({ fields: 'user' });

      return {
        connected: true,
        folderId: folderId || null,
      };
    }

    return { connected: false };
  } catch (error) {
    console.error('Error checking Google Drive status:', error);
    return { connected: false, error: 'Connection failed' };
  }
}

export async function disconnectGoogleDrive() {
  const session = await auth();

  if (!session?.user || session.user.role !== Role.ADMIN) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    await saveSetting('google_drive_credentials', null);
    await saveSetting('google_drive_folder_id', null);
    return { success: true };
  } catch (error) {
    console.error('Error disconnecting Google Drive:', error);
    return { success: false, error: 'Failed to disconnect' };
  }
}

export async function saveGoogleDriveCredentials(
  clientId: string,
  clientSecret: string
) {
  const session = await auth();

  if (!session?.user || session.user.role !== Role.ADMIN) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    await saveSetting('google_drive_oauth_credentials', {
      clientId,
      clientSecret,
    });
    return { success: true };
  } catch (error) {
    console.error('Error saving Google Drive credentials:', error);
    return { success: false, error: 'Failed to save credentials' };
  }
}

export async function getGoogleDriveCredentials() {
  const session = await auth();

  if (!session?.user || session.user.role !== Role.ADMIN) {
    return null;
  }

  try {
    const creds = await getSetting('google_drive_oauth_credentials');
    return creds as { clientId: string; clientSecret: string } | null;
  } catch (error) {
    console.error('Error getting Google Drive credentials:', error);
    return null;
  }
}
