import { prisma } from '@/lib/prisma';

/** Server only, not a server action: the browser must not be able to write log entries. */
export async function logActivity(userId: string | undefined, action: string, details: string) {
  try {
    await prisma.activityLog.create({
      data: {
        userId,
        action,
        details,
      },
    });
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
}
