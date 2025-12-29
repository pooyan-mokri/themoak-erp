
'use server';

// We don't have an ActivityLog model yet!
// We need to add it to schema.prisma first.
// But for now, let's just log to console or create a simple model if we can.
// Wait, the plan said "Activity Logs".
// Let's check schema.prisma again. There is no ActivityLog model.
// I should add it.

import { PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/prisma';

// const prisma = new PrismaClient();

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

export async function getRecentActivities() {
  try {
    const activities = await prisma.activityLog.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: { user: true },
    });

    return activities.map((activity: any) => ({
      ...activity,
      userId: activity.userId ?? undefined,
      user: activity.user ? {
        ...activity.user,
        phone: activity.user.phone ?? undefined,
      } : undefined,
    }));
  } catch (error) {
    return [];
  }
}
