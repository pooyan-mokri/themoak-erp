import { ProjectForm } from '@/components/projects/project-form';

export default function NewProjectPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">پروژه جدید</h1>
      </div>
      <ProjectForm />
    </div>
  );
}
