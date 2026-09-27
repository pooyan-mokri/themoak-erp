import { getProjectById, getProjectFigures } from '@/actions/project';
import { ProjectForm } from '@/components/projects/project-form';
import { ProjectStatusBadge } from '@/components/projects/project-status-badge';
import { TaskBoard } from '@/components/projects/task-board';
import { TaskForm } from '@/components/projects/task-form';
import { ProjectCalendarView } from '@/components/projects/project-calendar-view';
import { Button } from '@/components/ui/button';
import { notFound } from 'next/navigation';
import { getUsers } from '@/actions/user';
import { DashboardBreadcrumb } from '@/components/layout/dashboard-breadcrumb';
import { ViewToggle } from '@/components/projects/view-toggle';
import { serializeDate } from '@/lib/serialize';
import { PageHeader } from '@/components/layout/page-header';
import { BackButton } from '@/components/ui/back-button';
import { fa } from '@/components/projects/project-labels';
import { formatJalaliDate } from '@/lib/date-utils';
import { hasPermission } from '@/lib/access';

export default async function ProjectDetailsPage({ params }: { params: { id: string } }) {
  let project;
  let users;
  const [figures, canManage] = await Promise.all([getProjectFigures(), hasPermission('projects.manage')]);

  try {
    project = await getProjectById(params.id);
    users = await getUsers();
    
    // Debug: Log task count
    if (project) {
      console.log(`Project ${params.id} has ${project.tasks.length} tasks:`, project.tasks.map((t: any) => ({ id: t.id, title: t.title, dueDate: t.dueDate })));
    }
  } catch (error) {
    console.error('Error fetching project or users:', error);
    throw error;
  }

  if (!project) {
    notFound();
  }

  const f = figures[project.id];
  const budget = Number(project.budget || 0);
  const facts = [
    project.startDate && { label: 'شروع', value: formatJalaliDate(project.startDate) },
    project.endDate && { label: 'پایان', value: formatJalaliDate(project.endDate) },
    project.budget && { label: 'بودجه', value: `${fa(budget)} تومان` },
    f?.spent !== undefined && {
      label: 'هزینه شده',
      value: `${fa(f.spent)} تومان${budget > 0 ? ` · ${fa((f.spent / budget) * 100)}٪ از بودجه` : ''}`,
    },
    f && f.tasks > 0 && { label: 'پیشرفت', value: `${fa(f.done)} از ${fa(f.tasks)} وظیفه${f.overdue ? ` · ${fa(f.overdue)} دیرکرد` : ''}` },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="flex h-full flex-col space-y-4">
      <DashboardBreadcrumb customLabel={project.name} />
      <BackButton href="/dashboard/projects" label="بازگشت به پروژه‌ها" />
      <PageHeader
        title={project.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <ProjectStatusBadge status={project.status} />
            <span>{project.description || 'بدون توضیحات'}</span>
          </span>
        }
        actions={
          canManage && (
            <>
              <ProjectForm project={project} trigger={<Button variant="outline">ویرایش پروژه</Button>} />
              <TaskForm projectId={project.id} users={users} />
            </>
          )
        }
      />

      {facts.length > 0 && (
        <dl className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border bg-card px-4 py-3 text-[13px]">
          {facts.map((fact) => (
            <div key={fact.label} className="flex gap-1.5">
              <dt className="text-muted-foreground">{fact.label}:</dt>
              <dd className="tabular-nums">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex-1 min-h-[500px]">
        <ViewToggle
          boardView={
            <TaskBoard tasks={project.tasks} projectId={project.id} users={users} canManage={canManage} />
          }
          calendarView={
            <ProjectCalendarView
              tasks={project.tasks.map((task: any) => ({
                id: task.id,
                title: task.title,
                status: task.status,
                priority: task.priority,
                startDate: serializeDate(task.startDate),
                dueDate: serializeDate(task.dueDate),
                assignedTo: task.assignedToUser ? {
                  id: task.assignedToUser.id,
                  name: task.assignedToUser.name
                } : undefined
              }))}
              projectId={project.id}
              projectStartDate={serializeDate(project.startDate)}
              projectEndDate={serializeDate(project.endDate)}
            />
          }
        />
      </div>
    </div>
  );
}
