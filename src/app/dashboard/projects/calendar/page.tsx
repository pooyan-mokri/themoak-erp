import { getProjectsForCalendar } from '@/actions/project';
import { CalendarView } from '@/components/projects/calendar-view';
import { PageHeader } from '@/components/layout/page-header';

export default async function ProjectsCalendarPage() {
  const projects = await getProjectsForCalendar();

  return (
    <div className="space-y-4">
      <PageHeader title="تقویم پروژه‌ها" description="مشاهده پروژه‌ها و وظایف در تقویم شمسی" />

      <CalendarView projects={projects} />
    </div>
  );
}
