import { getProjectsForCalendar } from '@/actions/project';
import { CalendarView } from '@/components/projects/calendar-view';

export default async function ProjectsCalendarPage() {
  const projects = await getProjectsForCalendar();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">تقویم پروژه‌ها</h1>
        <p className="text-muted-foreground mt-2">
          مشاهده پروژه‌ها و وظایف در تقویم شمسی
        </p>
      </div>

      <CalendarView projects={projects} />
    </div>
  );
}




