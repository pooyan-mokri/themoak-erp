'use client';

import { updateTaskStatus } from '@/actions/project';
import { TaskCard } from '@/components/projects/task-card';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { createPortal } from 'react-dom';
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useDroppable } from '@dnd-kit/core';

interface User {
  id: string;
  name: string;
  email: string;
}

interface Task {
  id: string;
  title: string;
  status: string;
  description?: string;
  priority?: string;
  dueDate?: Date | string;
  assignedTo?: string;
  assignedToUser?: User;
}

interface TaskBoardProps {
  tasks: Task[];
  projectId: string;
  users?: User[];
  /** May move and edit tasks (projects.manage). */
  canManage?: boolean;
}

const COLUMNS = [
  { id: 'TODO', title: 'برای انجام' },
  { id: 'IN_PROGRESS', title: 'در حال انجام' },
  { id: 'REVIEW', title: 'در حال بررسی' },
  { id: 'DONE', title: 'انجام شده' },
];

interface TaskColumnProps {
  id: string;
  title: string;
  tasks: Task[];
  projectId: string;
  users?: User[];
  canManage: boolean;
}

function TaskColumn({ id, title, tasks, projectId, users, canManage }: TaskColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[500px] flex-col gap-3 rounded-lg border p-3 transition-colors duration-150 ${
        isOver ? 'border-brand bg-brand/[.04]' : 'border-transparent bg-secondary'
      }`}
    >
      <div className="flex items-center justify-between px-1">
        <h3 className="text-[13px] font-medium">{title}</h3>
        <span className="rounded bg-card px-1.5 font-mono text-[11px] text-muted-foreground">
          {tasks.length.toLocaleString('fa-IR')}
        </span>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} projectId={projectId} users={users} canManage={canManage} />
          ))}
        </div>
      </SortableContext>
      {tasks.length === 0 && <p className="py-6 text-center text-[12px] text-muted-foreground">وظیفه‌ای در این ستون نیست.</p>}
    </div>
  );
}

export function TaskBoard({ tasks, projectId, users = [], canManage = true }: TaskBoardProps) {
  const [activeTask, setActiveTask] = useState<Task | undefined>(undefined);
  const [optimisticTasks, setOptimisticTasks] = useState(tasks);

  // Debug: Log tasks
  console.log('TaskBoard received tasks:', tasks.length, tasks.map((t) => ({ id: t.id, title: t.title, status: t.status })));

  // Fix tasks with invalid status - if status is not in COLUMNS, set to TODO
  // Create a stable dependency key from task IDs to prevent infinite loops
  const knownStatuses = COLUMNS.map(col => col.id);
  const tasksKey = useMemo(() => tasks.map((t) => `${t.id}-${t.status}`).join(','), [tasks]);

  const fixedTasks = useMemo(() => {
    return tasks.map((t) => {
      if (!knownStatuses.includes(t.status)) {
        console.warn(`Task ${t.id} has invalid status "${t.status}", setting to TODO`);
        return { ...t, status: 'TODO' };
      }
      return t;
    });
  }, [tasks]);

  // Debug: Check for tasks with unknown status
  const unknownStatusTasks = fixedTasks.filter((t) => !knownStatuses.includes(t.status));
  if (unknownStatusTasks.length > 0) {
    console.warn('Tasks with unknown status after fix:', unknownStatusTasks.map((t) => ({ id: t.id, title: t.title, status: t.status })));
  }

  // Update optimistic state when props change - use tasksKey as stable dependency
  useEffect(() => {
    if (!activeTask) {
      setOptimisticTasks(fixedTasks);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksKey, activeTask]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  function handleDragStart(event: DragStartEvent) {
    const { active } = event;
    const task = optimisticTasks.find((t) => t.id === active.id);
    setActiveTask(task);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTask(undefined);

    if (!over) return;

    const taskId = active.id as string;
    let newStatus = over.id as string;
    const task = optimisticTasks.find((t) => t.id === taskId);

    if (!task) return;

    // If dropped on another task card, find which column that task belongs to
    if (!COLUMNS.find(col => col.id === newStatus)) {
      const targetTask = optimisticTasks.find((t) => t.id === newStatus);
      if (targetTask) {
        newStatus = targetTask.status;
      } else {
        // If we can't determine the column, don't update
        return;
      }
    }

    if (task.status === newStatus) return;

    // Optimistic update
    const updatedTasks = optimisticTasks.map((t) =>
      t.id === taskId ? { ...t, status: newStatus } : t
    );
    setOptimisticTasks(updatedTasks);

    // Server action
    const result = await updateTaskStatus(taskId, newStatus, projectId);
    if (!result.success) {
      toast.error('خطا در بروزرسانی وضعیت');
      // Revert on error
      setOptimisticTasks(tasks);
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="grid h-full grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        {COLUMNS.map((col) => {
          const columnTasks = optimisticTasks.filter((t) => t.status === col.id);
          console.log(`Column ${col.id} (${col.title}): ${columnTasks.length} tasks`, columnTasks.map((t) => ({ id: t.id, title: t.title })));
          return (
            <TaskColumn
              key={col.id}
              id={col.id}
              title={col.title}
              tasks={columnTasks}
              projectId={projectId}
              users={users}
              canManage={canManage}
            />
          );
        })}
      </div>

      {createPortal(
        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} projectId={projectId} users={users} /> : null}
        </DragOverlay>,
        document.body
      )}
    </DndContext>
  );
}
