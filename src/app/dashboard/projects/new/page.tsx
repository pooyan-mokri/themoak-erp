import { ProjectForm } from '@/components/projects/project-form';
import { hasPermission } from '@/lib/access';

export default async function NewProjectPage() {
  const showBudget = await hasPermission('finance.view');
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">پروژه جدید</h1>
      </div>
      <ProjectForm showBudget={showBudget} />
    </div>
  );
}
