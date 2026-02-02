'use server';

import { testFTPConnection } from '@/lib/ftp';
import { getSetting, saveSetting } from './settings';
import { auth } from '@/auth';
import { Role } from '@prisma/client';

export async function saveFTPCredentials(credentials: {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
  basePath?: string;
}) {
  const session = await auth();

  if (!session?.user || session.user.role !== Role.ADMIN) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    await saveSetting('ftp_credentials', credentials);
    return { success: true };
  } catch (error) {
    console.error('Error saving FTP credentials:', error);
    return { success: false, error: 'Failed to save credentials' };
  }
}

export async function getFTPCredentials() {
  const session = await auth();

  if (!session?.user || session.user.role !== Role.ADMIN) {
    return null;
  }

  try {
    const creds = await getSetting('ftp_credentials');
    return creds as
      | {
          host: string;
          port: number;
          user: string;
          password: string;
          secure: boolean;
          basePath?: string;
        }
      | null;
  } catch (error) {
    console.error('Error getting FTP credentials:', error);
    return null;
  }
}

export async function testFTPConnectionAction() {
  const session = await auth();

  if (!session?.user || session.user.role !== Role.ADMIN) {
    return { success: false, error: 'Unauthorized' };
  }

  try {
    const result = await testFTPConnection();
    return result;
  } catch (error: any) {
    console.error('Error testing FTP connection:', error);
    return {
      success: false,
      error: error?.message || 'Failed to test connection',
    };
  }
}

