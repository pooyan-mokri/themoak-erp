import { cn } from '@/lib/utils';
import { PILL, projectStatus } from './project-labels';

interface ProjectStatusBadgeProps {
  status: string;
}

export function ProjectStatusBadge({ status }: ProjectStatusBadgeProps) {
  const s = projectStatus(status);
  return <span className={cn(PILL, s.tone)}>{s.label}</span>;
}
