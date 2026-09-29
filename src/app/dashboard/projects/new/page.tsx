import { ProjectForm } from '@/components/projects/project-form';
import { PageHeader } from '@/components/layout/page-header';
import { hasPermission } from '@/lib/access';

export default async function NewProjectPage() {
  const showBudget = await hasPermission('finance.view');
  return (
    <div className="space-y-4">
      <PageHeader title="پروژه جدید" actions={<ProjectForm showBudget={showBudget} />} />
    </div>
  );
}
