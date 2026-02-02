'use server';

import { Client } from 'basic-ftp';
import { getSetting } from '@/actions/settings';

interface FTPCredentials {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
  basePath?: string;
}

/**
 * Get FTP client with credentials from settings
 */
async function getFTPClient(): Promise<Client> {
  const ftpCreds = (await getSetting('ftp_credentials')) as
    | FTPCredentials
    | undefined;

  if (!ftpCreds?.host || !ftpCreds?.user || !ftpCreds?.password) {
    throw new Error(
      'FTP credentials not configured. Please set FTP credentials in settings.'
    );
  }

  const client = new Client();
  client.ftp.verbose = false; // Set to true for debugging

  return client;
}

/**
 * Test FTP connection
 */
export async function testFTPConnection(): Promise<{
  success: boolean;
  error?: string;
}> {
  let client: Client | null = null;
  try {
    const ftpCreds = (await getSetting('ftp_credentials')) as
      | FTPCredentials
      | undefined;

    if (!ftpCreds?.host || !ftpCreds?.user || !ftpCreds?.password) {
      return {
        success: false,
        error: 'FTP credentials not configured',
      };
    }

    client = new Client();
    client.ftp.verbose = false;

    // Connect with timeout
    await client.access({
      host: ftpCreds.host,
      port: ftpCreds.port || 21,
      user: ftpCreds.user,
      password: ftpCreds.password,
      secure: ftpCreds.secure || false,
    });

    // Test by listing current directory
    await client.list();

    return { success: true };
  } catch (error: any) {
    console.error('[FTP] Connection test error:', error);
    return {
      success: false,
      error: error?.message || 'Failed to connect to FTP server',
    };
  } finally {
    if (client) {
      try {
        client.close();
      } catch (e) {
        // Ignore close errors
      }
    }
  }
}

/**
 * Upload file to FTP server
 */
export async function uploadToFTP(
  fileBuffer: Buffer,
  fileName: string
): Promise<{ url: string; path: string }> {
  let client: Client | null = null;
  try {
    const ftpCreds = (await getSetting('ftp_credentials')) as
      | FTPCredentials
      | undefined;

    if (!ftpCreds?.host || !ftpCreds?.user || !ftpCreds?.password) {
      throw new Error('FTP credentials not configured');
    }

    client = new Client();
    client.ftp.verbose = false;

    // Connect
    await client.access({
      host: ftpCreds.host,
      port: ftpCreds.port || 21,
      user: ftpCreds.user,
      password: ftpCreds.password,
      secure: ftpCreds.secure || false,
    });

    // Navigate to base path if specified
    const basePath = ftpCreds.basePath || '/uploads/receipts';
    try {
      await client.ensureDir(basePath);
    } catch (error) {
      console.warn('[FTP] Could not ensure directory, trying to create:', error);
      // Try to create directory
      await client.ensureDir(basePath);
    }

    // Upload file
    const remotePath = `${basePath}/${fileName}`;
    await client.uploadFrom(fileBuffer, remotePath);

    // Construct URL (assuming FTP server is accessible via HTTP)
    // You may need to adjust this based on your FTP server setup
    const url = `ftp:${remotePath}`;

    return { url, path: remotePath };
  } catch (error: any) {
    console.error('[FTP] Upload error:', error);
    throw new Error(error?.message || 'Failed to upload to FTP server');
  } finally {
    if (client) {
      try {
        client.close();
      } catch (e) {
        // Ignore close errors
      }
    }
  }
}

/**
 * Delete file from FTP server
 */
export async function deleteFromFTP(filePath: string): Promise<void> {
  let client: Client | null = null;
  try {
    const ftpCreds = (await getSetting('ftp_credentials')) as
      | FTPCredentials
      | undefined;

    if (!ftpCreds?.host || !ftpCreds?.user || !ftpCreds?.password) {
      throw new Error('FTP credentials not configured');
    }

    client = new Client();
    client.ftp.verbose = false;

    // Connect
    await client.access({
      host: ftpCreds.host,
      port: ftpCreds.port || 21,
      user: ftpCreds.user,
      password: ftpCreds.password,
      secure: ftpCreds.secure || false,
    });

    // Remove ftp: prefix if present
    const cleanPath = filePath.startsWith('ftp:') ? filePath.slice(4) : filePath;

    // Delete file
    await client.remove(cleanPath);
  } catch (error: any) {
    console.error('[FTP] Delete error:', error);
    throw new Error(error?.message || 'Failed to delete from FTP server');
  } finally {
    if (client) {
      try {
        client.close();
      } catch (e) {
        // Ignore close errors
      }
    }
  }
}

