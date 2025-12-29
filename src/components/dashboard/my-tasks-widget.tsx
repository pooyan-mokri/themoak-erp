'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { formatJalaliDate } from '@/lib/date-utils';
import Link from 'next/link';

interface Task {
  id: string;
  title: string;
  projectName: string;
  status: string;
  deadline?: Date;
  priority: string;
}

interface MyTasksWidgetProps {
  tasks: Task[];
}

export function MyTasksWidget({ tasks }: MyTasksWidgetProps) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'IN_PROGRESS':
        return <Clock className="h-4 w-4 text-blue-600" />;
      default:
        return <AlertCircle className="h-4 w-4 text-orange-600" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      PENDING: { variant: 'outline', label: 'در انتظار' },
      IN_PROGRESS: { variant: 'default', label: 'در حال انجام' },
      COMPLETED: { variant: 'secondary', label: 'تکمیل شده' },
    };

    const config = variants[status] || variants.PENDING;
    return <Badge variant={config.variant as any}>{config.label}</Badge>;
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'HIGH':
        return 'text-red-600';
      case 'MEDIUM':
        return 'text-orange-600';
      default:
        return 'text-gray-600';
    }
  };

  if (tasks.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" />
            وظایف من
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            شما وظیفه باز ندارید ✓
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" />
            وظایف من ({tasks.length})
          </CardTitle>
          <Link href="/dashboard/projects" className="text-sm text-primary hover:underline">
            مشاهده همه
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-start gap-3 p-3 rounded-lg border hover:bg-accent cursor-pointer"
            >
              {getStatusIcon(task.status)}
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{task.title}</p>
                  {getStatusBadge(task.status)}
                </div>
                <p className="text-xs text-muted-foreground">
                  پروژه: {task.projectName}
                </p>
                {task.deadline && (
                  <p className={`text-xs ${getPriorityColor(task.priority)}`}>
                    مهلت: {formatJalaliDate(task.deadline)}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
