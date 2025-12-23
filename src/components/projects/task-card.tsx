import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Calendar, User } from 'lucide-react';
import { TaskForm } from './task-form';
import { useState } from 'react';

interface TaskCardProps {
  task: any;
  projectId: string;
  users?: Array<{ id: string; name: string; email: string }>;
}

export function TaskCard({ task, projectId, users = [] }: TaskCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'URGENT': return 'bg-red-500 hover:bg-red-600';
      case 'HIGH': return 'bg-orange-500 hover:bg-orange-600';
      case 'MEDIUM': return 'bg-blue-500 hover:bg-blue-600';
      case 'LOW': return 'bg-slate-500 hover:bg-slate-600';
      default: return 'bg-slate-500';
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    // Only open edit dialog if not dragging (drag activation requires 8px movement)
    if (!isDragging) {
      setIsEditing(true);
    }
  };

  return (
    <>
      <div 
        ref={setNodeRef} 
        style={style} 
        {...attributes}
        {...listeners}
        className="touch-none relative group cursor-grab active:cursor-grabbing"
      >
        <Card 
          className="hover:shadow-lg hover:scale-[1.02] transition-all duration-300 ease-out hover:border-primary/20"
          onClick={handleClick}
        >
          <CardHeader className="p-3 pb-0 space-y-0">
            <div className="flex justify-between items-start gap-2">
              <h4 className="font-medium text-sm line-clamp-2">{task.title}</h4>
              <Badge className={`text-[10px] px-1.5 py-0 h-5 ${getPriorityColor(task.priority)} animate-pulse-slow`}>
                {task.priority}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-3 text-xs text-muted-foreground">
            {task.description && <p className="line-clamp-2 mb-2">{task.description}</p>}
          </CardContent>
          <CardFooter className="p-3 pt-0 flex justify-between items-center text-xs text-muted-foreground">
            {task.dueDate && (
              <div className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                <span>{new Date(task.dueDate).toLocaleDateString('fa-IR')}</span>
              </div>
            )}
            {task.assignedTo && (
              <div className="flex items-center gap-1 ml-auto">
                <User className="h-3 w-3" />
                <span>{task.assignedTo}</span>
              </div>
            )}
          </CardFooter>
        </Card>
      </div>
      <TaskForm 
        projectId={projectId}
        task={task}
        open={isEditing}
        onOpenChange={setIsEditing}
        users={users}
      />
    </>
  );
}
