import { formatJalaliDate } from '@/lib/date-utils';
import { SectionCard } from './section-card';

interface ActivityItem {
  id: string;
  userName: string;
  action: string;
  description: string;
  timestamp: Date;
}

const fa = (n: number) => new Intl.NumberFormat('fa-IR').format(n);

/** Who did what, newest first. */
export function RecentActivity({ activities }: { activities: ActivityItem[] }) {
  return (
    <SectionCard title="فعالیت‌های اخیر" count={fa(activities.length)}>
      {activities.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">هنوز فعالیتی ثبت نشده است.</p>
      ) : (
        <div className="divide-y">
          {activities.map((activity, index) => (
            <div key={activity.id} className="flex items-start gap-3 py-2.5">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${index === 0 ? 'bg-brand' : 'bg-muted-foreground/40'}`} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{activity.userName}</p>
                <p className="text-[12.5px] text-muted-foreground">{activity.description}</p>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {formatJalaliDate(activity.timestamp, 'jMM/jDD HH:mm')}
              </span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
