import Link from 'next/link';
import { SectionCard } from '@/components/dashboard/section-card';
import { formatJalaliDate } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import { tehranDay, tehranDayStart } from '@/lib/tehran-day';
import { PILL, fa, taskPriority, taskStatus } from './project-labels';

type MyTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate?: Date;
  project: { id: string; name: string };
};

/** The signed-in user's open tasks across projects, soonest due first. */
export function MyTasks({ tasks }: { tasks: MyTask[] }) {
  // Today's Tehran midnight, on the server (UTC) and in the browser alike.
  const today = tehranDayStart(tehranDay(new Date()));

  return (
    <SectionCard title="کارهای من" count={tasks.length ? fa(tasks.length) : undefined}>
      {tasks.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] text-muted-foreground">
          وظیفهٔ بازی به شما محول نشده است. وظایف هر پروژه روی تابلوی همان پروژه به افراد سپرده می‌شوند.
        </p>
      ) : (
        <ul className="divide-y">
          {tasks.map((task) => {
            const status = taskStatus(task.status);
            const priority = taskPriority(task.priority);
            const overdue = task.dueDate && new Date(task.dueDate) < today;
            return (
              <li key={task.id} className="py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/dashboard/projects/${task.project.id}`} className="min-w-0 text-[13px] font-medium hover:text-brand">
                    {task.title}
                  </Link>
                  <span className={cn(PILL, status.tone)}>{status.label}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
                  <span className="truncate">{task.project.name}</span>
                  {task.dueDate && (
                    <span className={cn('font-mono', overdue && 'text-danger')}>
                      سررسید {formatJalaliDate(task.dueDate)}
                      {overdue && ' · دیرکرد'}
                    </span>
                  )}
                  {(task.priority === 'HIGH' || task.priority === 'URGENT') && (
                    <span className={cn(PILL, priority.tone)}>{priority.label}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
