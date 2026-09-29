import Link from 'next/link';
import { AlarmClock, Briefcase, Calendar, Coins, Wallet } from 'lucide-react';
import { getMyTasks, getProjectFigures, getProjects } from '@/actions/project';
import { ProjectForm } from '@/components/projects/project-form';
import { ProjectList } from '@/components/projects/project-list';
import { MyTasks } from '@/components/projects/my-tasks';
import { fa } from '@/components/projects/project-labels';
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { Button } from '@/components/ui/button';
import { hasPermission } from '@/lib/access';

/** Projects: status, progress, budget and what was spent, and the signed-in user's open tasks. */
export default async function ProjectsPage() {
  const [projects, figures, myTasks, canManage, showBudget] = await Promise.all([
    getProjects(),
    getProjectFigures(),
    getMyTasks(),
    hasPermission('projects.manage'),
    // The budget is finance data: shown to, and set by, finance.view only.
    hasPermission('finance.view'),
  ]);

  const active = projects.filter((p: any) => p.status === 'ACTIVE').length;
  const budget = projects.reduce((sum: number, p: any) => sum + Number(p.budget || 0), 0);
  const all = Object.values(figures);
  const spent = all.reduce((sum, f) => sum + (f.spent ?? 0), 0);
  const overdue = all.reduce((sum, f) => sum + f.overdue, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="پروژه‌ها"
        description="مدیریت پروژه‌ها و وظایف سازمانی"
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/dashboard/projects/calendar">
                <Calendar className="h-4 w-4" />
                نمای تقویمی
              </Link>
            </Button>
            {canManage && <ProjectForm showBudget={showBudget} />}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="پروژه‌های فعال" icon={Briefcase} value={fa(active)} note={`از ${fa(projects.length)} پروژه`} />
        {showBudget ? (
          <>
            <KpiCard label="بودجه کل" icon={Coins} value={budget ? fa(budget) : '—'} unit={budget ? 'تومان' : undefined} note="جمع بودجهٔ پروژه‌ها" />
            <KpiCard
              label="هزینه شده"
              icon={Wallet}
              value={fa(spent)}
              unit="تومان"
              note={budget > 0 ? `${fa((spent / budget) * 100)}٪ از بودجه · هزینه‌های ثبت‌شده روی پروژه` : 'هزینه‌های ثبت‌شده روی پروژه'}
            />
          </>
        ) : (
          <>
            <KpiCard label="بودجه کل" icon={Coins} value="—" note="با دسترسی مالی دیده می‌شود" />
            <KpiCard label="هزینه شده" icon={Wallet} value="—" note="با دسترسی مالی دیده می‌شود" />
          </>
        )}
        <KpiCard label="وظایف دیرکرد" icon={AlarmClock} value={fa(overdue)} note="سررسید گذشته و انجام‌نشده" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <ProjectList projects={projects} figures={figures} showBudget={showBudget} />
        <MyTasks tasks={myTasks} />
      </div>
    </div>
  );
}
