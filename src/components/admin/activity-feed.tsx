
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { activityLabel } from '@/lib/activity-labels';

interface ActivityFeedProps {
  activities: any[];
}

export function ActivityFeed({ activities }: ActivityFeedProps) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>فعالیت‌های اخیر</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-4">
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center">فعالیتی ثبت نشده است.</p>
            ) : (
              activities.map((activity) => (
                <div key={activity.id} className="flex flex-col space-y-1 border-b pb-2 last:border-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {activityLabel(activity.action)} <span className="font-normal text-muted-foreground">· {activity.user?.name || 'سیستم'}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(activity.createdAt).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' })}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{activity.details}</p>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
