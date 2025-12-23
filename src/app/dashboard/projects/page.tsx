import { getProjects } from '@/actions/project';
import { ProjectForm } from '@/components/projects/project-form';
import { ProjectList } from '@/components/projects/project-list';
import { Calendar } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default async function ProjectsPage() {
  const projects = await getProjects();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">پروژه‌ها</h2>
          <p className="text-muted-foreground">مدیریت پروژه‌ها و وظایف سازمانی</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/projects/calendar">
            <Button variant="outline">
              <Calendar className="h-4 w-4 ml-2" />
              نمای تقویمی
            </Button>
          </Link>
          <ProjectForm />
        </div>
      </div>

      <ProjectList projects={projects} />
    </div>
  );
}
