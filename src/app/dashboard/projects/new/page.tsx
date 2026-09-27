import { ProjectForm } from '@/components/projects/project-form';
import { PageHeader } from '@/components/layout/page-header';

export default function NewProjectPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="پروژه جدید" actions={<ProjectForm />} />
    </div>
  );
}
