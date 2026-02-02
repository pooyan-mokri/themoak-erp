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
  } catch (error) {
    console.error('Error generating Google Drive auth URL:', error);
    return { success: false, error: 'Failed to generate auth URL' };
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
