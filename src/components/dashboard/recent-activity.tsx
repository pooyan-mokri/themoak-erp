'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity } from 'lucide-react';
import { formatJalaliDate } from '@/lib/date-utils';

interface ActivityItem {
  id: string;
  userName: string;
  action: string;
  description: string;
  timestamp: Date;
}

interface RecentActivityProps {
  activities: ActivityItem[];
}

const actionIcons: Record<string, string> = {
  CREATE_ORDER: '🛒',
  UPDATE_INVENTORY: '📦',
  RECORD_EXPENSE: '💰',
  CREATE_CUSTOMER: '👤',
  CREATE_INVOICE: '📄',
  CREATE_USER: '👥',
  UPDATE_PRODUCT: '✏️',
  DELETE_ORDER: '🗑️',
  default: '📋'
};

export function RecentActivity({ activities }: RecentActivityProps) {
  if (activities.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            فعالیت‌های اخیر
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            فعالیتی ثبت نشده است
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          فعالیت‌های اخیر
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activities.map((activity) => (
            <div key={activity.id} className="flex gap-3 pb-4 border-b last:border-0 last:pb-0">
              <div className="text-2xl">
                {actionIcons[activity.action] || actionIcons.default}
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{activity.userName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatJalaliDate(activity.timestamp, 'jMM/jDD HH:mm')}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">{activity.description}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
