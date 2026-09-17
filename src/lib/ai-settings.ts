import { prisma } from '@/lib/prisma';

/**
 * The AI settings row with its API key, for server code that calls the
 * provider. Not a server action: never return this row, or pass it, to the
 * browser. The browser gets getAISettings, which drops the key.
 */
export async function readAISettingsWithKey() {
  return prisma.aISettings.findFirst();
}
