import { getProjectById } from '@/actions/project';
import { ProjectForm } from '@/components/projects/project-form';
import { ProjectStatusBadge } from '@/components/projects/project-status-badge';
import { TaskBoard } from '@/components/projects/task-board';
import { TaskForm } from '@/components/projects/task-form';
import { ProjectCalendarView } from '@/components/projects/project-calendar-view';
import { Button } from '@/components/ui/button';
import { ArrowRight, Calendar, Coins } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getUsers } from '@/actions/user';
import { DashboardBreadcrumb } from '@/components/layout/dashboard-breadcrumb';
import { ViewToggle } from '@/components/projects/view-toggle';
import { serializeDate } from '@/lib/serialize';

export default async function ProjectDetailsPage({ params }: { params: { id: string } }) {
  let project;
  let users;
  
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

  return (
    <div className="space-y-6 h-full flex flex-col">
      <DashboardBreadcrumb customLabel={project.name} />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/projects">
            <Button variant="ghost" size="icon">
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-2xl font-bold tracking-tight">{project.name}</h2>
              <ProjectStatusBadge status={project.status} />
            </div>
            <p className="text-sm text-muted-foreground/80 leading-relaxed max-w-2xl">
              {project.description || 'بدون توضیحات'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ProjectForm project={project} trigger={<Button variant="outline">ویرایش پروژه</Button>} />
          <TaskForm projectId={project.id} users={users} />
        </div>
      </div>

      <div className="flex flex-wrap gap-6 text-sm text-muted-foreground border-b pb-4">
        {project.startDate && (
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span>شروع: {new Date(project.startDate).toLocaleDateString('fa-IR')}</span>
          </div>
        )}
        {project.endDate && (
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span>پایان: {new Date(project.endDate).toLocaleDateString('fa-IR')}</span>
          </div>
        )}
        {project.budget && (
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4" />
            <span>بودجه: {new Intl.NumberFormat('fa-IR').format(Number(project.budget))} تومان</span>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-[500px]">
        <ViewToggle
          boardView={
            <TaskBoard tasks={project.tasks} projectId={project.id} users={users} />
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
