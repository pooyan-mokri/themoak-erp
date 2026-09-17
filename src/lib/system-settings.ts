import { prisma } from '@/lib/prisma';

/**
 * Reads a SystemSetting with no session check, for server code only: the FTP
 * password is stored here. Not a server action, so the browser cannot call it;
 * the browser-reachable reader is getSetting in src/actions/settings.ts.
 */
export async function readSystemSetting(key: string) {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key },
    });
    return setting?.value ? JSON.parse(setting.value) : undefined;
  } catch (error) {
    console.error(`Error fetching setting ${key}:`, error);
    return undefined;
  }
}
