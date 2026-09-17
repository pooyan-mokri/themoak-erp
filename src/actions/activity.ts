
'use server';

// We don't have an ActivityLog model yet!
// We need to add it to schema.prisma first.
// But for now, let's just log to console or create a simple model if we can.
// Wait, the plan said "Activity Logs".
// Let's check schema.prisma again. There is no ActivityLog model.
// I should add it.

import { PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

// const prisma = new PrismaClient();

// logActivity lives in @/lib/activity-log: an export here would be a server action anyone could call.

/** Every user's activity: for an admin only, and never with the password hash. */
export async function getRecentActivities() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return [];
  }

  try {
    const activities = await prisma.activityLog.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
    });

    return activities.map((activity: any) => ({
      ...activity,
      userId: activity.userId ?? undefined,
      user: activity.user ?? undefined,
    }));
  } catch (error) {
    return [];
  }
}
