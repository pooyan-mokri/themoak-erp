import Link from 'next/link';
import { CheckCircle2, Circle, CircleDot } from 'lucide-react';
import { formatJalaliDate } from '@/lib/date-utils';
import { SectionCard } from './section-card';

interface Task {
  id: string;
  title: string;
  projectName: string;
  status: string;
  deadline?: Date;
  priority: string;
}

const fa = (n: number) => new Intl.NumberFormat('fa-IR').format(n);
const STATUS: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'در انتظار', className: 'bg-secondary text-muted-foreground' },
  IN_PROGRESS: { label: 'در جریان', className: 'bg-brand-soft text-brand' },
  COMPLETED: { label: 'تکمیل شده', className: 'bg-success-soft text-success' },
};

/** The signed-in user's open tasks, from their projects. */
export function MyTasksWidget({ tasks }: { tasks: Task[] }) {
  return (
    <SectionCard title="وظایف من" count={fa(tasks.length)} link={{ href: '/dashboard/projects', label: 'همه ←' }}>
      {tasks.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">وظیفهٔ بازی ندارید.</p>
      ) : (
        <div className="divide-y">
          {tasks.map((task) => {
            const status = STATUS[task.status] ?? STATUS.PENDING;
            const Icon = task.status === 'COMPLETED' ? CheckCircle2 : task.status === 'IN_PROGRESS' ? CircleDot : Circle;
            const late = task.deadline && task.status !== 'COMPLETED' && new Date(task.deadline) < new Date();
            return (
              <div key={task.id} className="flex items-start gap-2.5 py-2">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px]">{task.title}</p>
                  <p className="truncate text-[11.5px] text-muted-foreground">
                    {task.projectName}
                    {task.deadline && (
                      <span className={late ? 'text-danger' : undefined}> · مهلت {formatJalaliDate(task.deadline)}</span>
                    )}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${status.className}`}>{status.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
