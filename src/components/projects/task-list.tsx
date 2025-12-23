'use client';

import { Task } from '@prisma/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TaskForm } from './task-form';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { deleteTask } from '@/actions/project';

interface TaskListProps {
  projectId: string;
  tasks: Task[];
}

export function TaskList({ projectId, tasks }: TaskListProps) {
  const todoTasks = tasks.filter(t => t.status === 'TODO');
  const inProgressTasks = tasks.filter(t => t.status === 'IN_PROGRESS');
  const doneTasks = tasks.filter(t => t.status === 'DONE');

  const handleDelete = async (taskId: string) => {
    if (confirm('آیا از حذف این تسک اطمینان دارید؟')) {
      await deleteTask(taskId, projectId);
    }
  };

  const TaskCard = ({ task }: { task: Task }) => (
    <div className="bg-muted/50 p-3 rounded-lg mb-2 space-y-2 group relative">
      <div className="flex justify-between items-start">
        <span className="font-medium">{task.title}</span>
        <TaskForm 
          projectId={projectId} 
          task={task} 
          trigger={<Button variant="ghost" size="sm" className="h-6 text-xs">ویرایش</Button>} 
        />
      </div>
      {task.assignedTo && (
        <Badge variant="outline" className="text-xs">
          {task.assignedTo}
        </Badge>
      )}
       <Button 
        variant="ghost" 
        size="icon" 
        className="absolute bottom-2 left-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
        onClick={() => handleDelete(task.id)}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground flex justify-between">
            برای انجام
            <Badge variant="secondary">{todoTasks.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {todoTasks.map(task => <TaskCard key={task.id} task={task} />)}
          <div className="mt-4">
            <TaskForm projectId={projectId} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-blue-500 flex justify-between">
            در حال انجام
            <Badge variant="secondary">{inProgressTasks.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {inProgressTasks.map(task => <TaskCard key={task.id} task={task} />)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-green-500 flex justify-between">
            انجام شده
            <Badge variant="secondary">{doneTasks.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {doneTasks.map(task => <TaskCard key={task.id} task={task} />)}
        </CardContent>
      </Card>
    </div>
  );
}
