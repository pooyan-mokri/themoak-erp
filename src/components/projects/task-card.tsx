import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Calendar, User } from 'lucide-react';
import { TaskForm } from './task-form';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { formatJalaliDate } from '@/lib/date-utils';
import { assigneeName } from '@/lib/task-assignee';
import { PILL, taskPriority } from './project-labels';

interface TaskCardProps {
  task: any;
  projectId: string;
  users?: Array<{ id: string; name: string }>;
  /** May move and edit tasks (projects.manage); the server checks it again. */
  canManage?: boolean;
}

export function TaskCard({ task, projectId, users = [], canManage = true }: TaskCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: !canManage });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleClick = () => {
    // Only open edit dialog if not dragging (drag activation requires 8px movement)
    if (!isDragging && canManage) {
      setIsEditing(true);
    }
  };

  const priority = taskPriority(task.priority);
  // assignedTo holds the user's id: show their name, never the id (src/lib/task-assignee.ts).
  const assignee = assigneeName(task, users);

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className={cn('relative touch-none', canManage && 'cursor-grab active:cursor-grabbing')}
      >
        <div
          className="space-y-2 rounded-md border bg-card p-3 transition-colors duration-150 hover:border-input"
          onClick={handleClick}
        >
          <div className="flex items-start justify-between gap-2">
            <h4 className="line-clamp-2 text-[13px] font-medium">{task.title}</h4>
            <span className={cn(PILL, priority.tone)}>{priority.label}</span>
          </div>
          {task.description && <p className="line-clamp-2 text-[12px] text-muted-foreground">{task.description}</p>}
          {(task.dueDate || assignee) && (
            <div className="flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
              {task.dueDate && (
                <span className="inline-flex items-center gap-1 font-mono">
                  <Calendar className="h-3 w-3" />
                  {formatJalaliDate(task.dueDate)}
                </span>
              )}
              {assignee && (
                <span className="ms-auto inline-flex min-w-0 items-center gap-1">
                  <User className="h-3 w-3 shrink-0" />
                  <span className="truncate">{assignee}</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      {canManage && (
        <TaskForm
          projectId={projectId}
          task={task}
          open={isEditing}
          onOpenChange={setIsEditing}
          users={users}
        />
      )}
    </>
  );
}
