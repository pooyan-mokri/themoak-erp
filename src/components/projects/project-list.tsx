'use client';

import { ProjectStatusBadge } from '@/components/projects/project-status-badge';
import { Button } from '@/components/ui/button';
import { ArrowRight, Calendar } from 'lucide-react';
import Link from 'next/link';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';
import { formatJalaliDate } from '@/lib/date-utils';

interface ProjectListProps {
  projects: any[];
}

export function ProjectList({ projects }: ProjectListProps) {
  const columns: DataTableColumn<any>[] = [
    {
      key: 'name',
      label: 'نام پروژه',
      sortable: true,
      render: (project) => (
        <div>
          <Link href={`/dashboard/projects/${project.id}`} className="hover:underline font-medium">
            {project.name}
          </Link>
          {project.description && (
            <p className="text-xs text-muted-foreground truncate max-w-[200px]">
              {project.description}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      label: 'وضعیت',
      sortable: true,
      render: (project) => <ProjectStatusBadge status={project.status} />,
    },
    {
      key: 'tasks',
      label: 'تعداد وظایف',
      sortable: true,
      render: (project) => project._count?.tasks || 0,
    },
    {
      key: 'budget',
      label: 'بودجه',
      sortable: true,
      render: (project) =>
        project.budget ? new Intl.NumberFormat('fa-IR').format(Number(project.budget)) : '-',
    },
    {
      key: 'startDate',
      label: 'تاریخ شروع',
      sortable: true,
      render: (project) =>
        project.startDate ? (
          <div className="flex items-center gap-1 text-sm">
            <Calendar className="h-3 w-3" />
            {formatJalaliDate(project.startDate)}
          </div>
        ) : (
          '-'
        ),
    },
    {
      key: 'actions',
      label: 'عملیات',
      sortable: false,
      className: 'text-left',
      render: (project) => (
        <Link href={`/dashboard/projects/${project.id}`}>
          <Button variant="ghost" size="icon">
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <DataTable
      data={projects}
      columns={columns}
      searchable={true}
      searchPlaceholder="جستجو در پروژه‌ها (نام، توضیحات)..."
      searchKeys={['name', 'description']}
      filterable={true}
      filters={[
        {
          key: 'status',
          label: 'وضعیت',
          options: [
            { value: 'PLANNING', label: 'در حال برنامه‌ریزی' },
            { value: 'IN_PROGRESS', label: 'در حال انجام' },
            { value: 'ON_HOLD', label: 'متوقف شده' },
            { value: 'COMPLETED', label: 'تکمیل شده' },
            { value: 'CANCELLED', label: 'لغو شده' },
          ],
        },
      ]}
      defaultSort={{ key: 'startDate', direction: 'desc' }}
      pageSize={10}
      emptyMessage="پروژه‌ای یافت نشد."
    />
  );
}
