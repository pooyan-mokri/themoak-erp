'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ActionState, ActionResult } from '@/lib/types';

const ProjectSchema = z.object({
  name: z.string().min(1, 'نام پروژه الزامی است'),
  description: z.string().optional(),
  status: z.enum(['ACTIVE', 'COMPLETED', 'ON_HOLD', 'CANCELLED']),
  startDate: z.string().optional(), // Will convert to Date
  endDate: z.string().optional(),   // Will convert to Date
  budget: z.coerce.number().optional(),
});

const TaskSchema = z.object({
  title: z.string().min(1, 'عنوان وظیفه الزامی است'),
  description: z.string().optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  startDate: z.string().optional(), // Will convert to Date
  dueDate: z.string().optional(), // Will convert to Date
  projectId: z.string().min(1, 'پروژه الزامی است'),
  assignedTo: z.string().optional(),
});

export async function createProject(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = ProjectSchema.safeParse({
    name: formData.get('name'),
    description: formData.get('description'),
    status: formData.get('status') || 'ACTIVE',
    startDate: formData.get('startDate'),
    endDate: formData.get('endDate'),
    budget: formData.get('budget'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, description, status, startDate, endDate, budget } = validatedFields.data;

  try {
    await prisma.project.create({
      data: {
        name,
        description,
        status,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        budget,
      },
    });
  } catch (error) {
    console.error('Error creating project:', error);
    return {
      message: 'خطا در ایجاد پروژه.',
      errors: undefined,
    };
  }

  revalidatePath('/dashboard/projects');
  return { message: 'پروژه با موفقیت ایجاد شد.', success: true, errors: undefined };
}

export async function getProjects() {
  try {
    const projects = await prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { tasks: true },
        },
      },
    });
    return projects.map(project => ({
      ...project,
      budget: project.budget ? Number(project.budget) : undefined,
      description: project.description ?? undefined,
      endDate: project.endDate ?? undefined,
      startDate: project.startDate ?? undefined,
    }));
  } catch (error) {
    throw new Error('Failed to fetch projects');
  }
}

export async function getProjectById(id: string) {
  try {
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        tasks: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    
    if (!project) return undefined;
    
    // Get all user IDs from tasks
    const userIds = project.tasks
      .map((t) => t.assignedTo)
      .filter((id): id is string => id !== null);
    
    // Fetch users
    const users = userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    
    const userMap = new Map(users.map((u) => [u.id, u]));
    
    // Map tasks with user information
    return {
      ...project,
      tasks: project.tasks.map((task) => ({
        ...task,
        assignedToUser: task.assignedTo ? userMap.get(task.assignedTo) : undefined,
      })),
    };
  } catch (error) {
    console.error('Error fetching project:', error);
    throw new Error('Failed to fetch project');
  }
}

export async function getProjectsForCalendar() {
  try {
    const projects = await prisma.project.findMany({
      include: {
        tasks: {
          where: {
            dueDate: { not: null },
          },
        },
      },
    });

    // Get all user IDs from tasks
    const userIds = projects
      .flatMap((p) => p.tasks)
      .map((t) => t.assignedTo)
      .filter((id): id is string => id !== null);

    // Fetch users
    const users = userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];

    const userMap = new Map(users.map((u) => [u.id, u]));

    // Map projects with user information
    return projects.map((project) => ({
      ...project,
      budget: project.budget ? Number(project.budget) : undefined,
      description: project.description ?? undefined,
      endDate: project.endDate ?? undefined,
      startDate: project.startDate ?? undefined,
      tasks: project.tasks.map((task) => ({
        ...task,
        description: task.description ?? undefined,
        dueDate: task.dueDate ?? undefined,
        endDate: task.endDate ?? undefined,
        startDate: task.startDate ?? undefined,
        assignedTo: task.assignedTo ? userMap.get(task.assignedTo) : undefined,
        project: {
          id: project.id,
          name: project.name,
        },
      })),
    }));
  } catch (error) {
    console.error('Error fetching projects for calendar:', error);
    return [];
  }
}

export async function createTask(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = TaskSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description'),
    status: formData.get('status') || 'TODO',
    priority: formData.get('priority') || 'MEDIUM',
    startDate: formData.get('startDate'),
    dueDate: formData.get('dueDate'),
    projectId: formData.get('projectId'),
    assignedTo: formData.get('assignedTo'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { title, description, status, priority, startDate, dueDate, projectId, assignedTo } = validatedFields.data;

  // Ensure start date is not after due date
  if (startDate && startDate.trim() && dueDate && dueDate.trim()) {
    const start = new Date(startDate);
    const due = new Date(dueDate);
    if (!isNaN(start.getTime()) && !isNaN(due.getTime()) && start > due) {
      return {
        success: false,
        message: 'تاریخ شروع باید قبل از تاریخ سررسید باشد.',
        errors: undefined,
      };
    }
  }

  try {
    await prisma.task.create({
      data: {
        title,
        description,
        status,
        priority,
        startDate: startDate && startDate.trim() ? new Date(startDate) : undefined,
        dueDate: dueDate && dueDate.trim() ? new Date(dueDate) : undefined,
        projectId,
        assignedTo: assignedTo || null,
      },
    });
  } catch (error) {
    console.error('Error creating task:', error);
    return {
      message: 'خطا در ایجاد وظیفه.',
      errors: undefined,
    };
  }

  revalidatePath(`/dashboard/projects/${projectId}`);
  return { message: 'وظیفه با موفقیت ایجاد شد.', success: true, errors: undefined };
}

export async function updateTaskStatus(taskId: string, status: string, projectId: string) {
  try {
    await prisma.task.update({
      where: { id: taskId },
      data: { status },
    });
    revalidatePath(`/dashboard/projects/${projectId}`);
    return { success: true };
  } catch (error) {
    console.error('Error updating task status:', error);
    return { success: false, message: 'خطا در بروزرسانی وضعیت.' };
  }
}

export async function deleteTask(taskId: string, projectId: string) {
  try {
    await prisma.task.delete({
      where: { id: taskId },
    });
    revalidatePath(`/dashboard/projects/${projectId}`);
    return { success: true };
  } catch (error) {
    console.error('Error deleting task:', error);
    return { success: false, message: 'خطا در حذف وظیفه.' };
  }
}

export async function updateProject(id: string, prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const validatedFields = ProjectSchema.safeParse({
    name: formData.get('name'),
    description: formData.get('description'),
    status: formData.get('status'),
    startDate: formData.get('startDate'),
    endDate: formData.get('endDate'),
    budget: formData.get('budget'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, description, status, startDate, endDate, budget } = validatedFields.data;

  try {
    await prisma.project.update({
      where: { id },
      data: {
        name,
        description,
        status,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        budget,
      },
    });
  } catch (error) {
    console.error('Error updating project:', error);
    return {
      message: 'خطا در بروزرسانی پروژه.',
      errors: undefined,
    };
  }

  revalidatePath(`/dashboard/projects/${id}`);
  revalidatePath('/dashboard/projects');
  return { message: 'پروژه با موفقیت بروزرسانی شد.', success: true, errors: undefined };
}

export async function updateTask(taskId: string, prevState: ActionState, formData: FormData): Promise<ActionResult> {
    console.log('=== updateTask START ===');
    console.log('taskId:', taskId);
    
    // Debug: log form data
    const formDataObj = {
        title: formData.get('title'),
        description: formData.get('description'),
        status: formData.get('status'),
        priority: formData.get('priority'),
        startDate: formData.get('startDate'),
        dueDate: formData.get('dueDate'),
        projectId: formData.get('projectId'),
        assignedTo: formData.get('assignedTo'),
    };
    console.log('FormData received:', formDataObj);
    console.log('startDate value:', formDataObj.startDate, 'type:', typeof formDataObj.startDate);
    console.log('dueDate value:', formDataObj.dueDate, 'type:', typeof formDataObj.dueDate);

    console.log('Validating form data...');
    const validatedFields = TaskSchema.safeParse(formDataObj);

    if (!validatedFields.success) {
        console.error('Validation failed!');
        console.error('Validation errors:', validatedFields.error.flatten().fieldErrors);
        const errorDetails = validatedFields.error.flatten().fieldErrors;
        console.error('Validation errors details:', errorDetails);
        return {
            success: false,
            errors: errorDetails,
            message: 'لطفا فیلدهای الزامی را پر کنید.',
        };
    }
    
    console.log('Validation passed successfully');

    const { title, description, status, priority, startDate, dueDate, projectId, assignedTo } = validatedFields.data;

    // Ensure start date is not after due date
    if (startDate && startDate.trim() && dueDate && dueDate.trim()) {
        const start = new Date(startDate);
        const due = new Date(dueDate);
        if (!isNaN(start.getTime()) && !isNaN(due.getTime()) && start > due) {
            return {
                success: false,
                message: 'تاریخ شروع باید قبل از تاریخ سررسید باشد.',
                errors: undefined,
            };
        }
    }

    console.log('Data to update:', {
        title,
        description,
        status,
        priority,
        startDate: startDate && startDate.trim() ? new Date(startDate) : null,
        dueDate: dueDate && dueDate.trim() ? new Date(dueDate) : null,
        assignedTo: assignedTo || null,
    });

    try {
        // Prepare data for update
        const updateData: Record<string, unknown> = {
            title,
            description: description || null,
            status,
            priority,
        };
        
        // Handle optional date fields
        // If date is provided, use it. If empty string, set to null to clear it.
        if (startDate && startDate.trim() && startDate.trim() !== '') {
            try {
                const parsedDate = new Date(startDate);
                if (!isNaN(parsedDate.getTime())) {
                    updateData.startDate = parsedDate;
                    console.log('startDate set to:', updateData.startDate);
                } else {
                    console.warn('Invalid startDate, skipping:', startDate);
                }
            } catch (e) {
                console.error('Error parsing startDate:', e);
            }
        } else {
            // Don't include startDate in update if it's empty (leave it unchanged)
            // If we want to clear it, we need to explicitly set to null
            console.log('startDate is empty, not updating');
        }
        
        if (dueDate && dueDate.trim() && dueDate.trim() !== '') {
            try {
                const parsedDate = new Date(dueDate);
                if (!isNaN(parsedDate.getTime())) {
                    updateData.dueDate = parsedDate;
                    console.log('dueDate set to:', updateData.dueDate);
                } else {
                    console.warn('Invalid dueDate, skipping:', dueDate);
                }
            } catch (e) {
                console.error('Error parsing dueDate:', e);
            }
        } else {
            // Don't include dueDate in update if it's empty (leave it unchanged)
            // If we want to clear it, we need to explicitly set to null
            console.log('dueDate is empty, not updating');
        }
        
        // Handle assignedTo - must be a valid user ID or null
        // If assignedTo is provided and not empty, use it (should be user ID)
        // If it's empty string or null, set to null
        if (assignedTo && assignedTo.trim() && assignedTo.trim() !== '') {
            const assignedToValue = assignedTo.trim();
            // For now, accept any non-empty string as assignedTo
            // Prisma will validate if it's a valid user ID
            updateData.assignedTo = assignedToValue;
        } else {
            updateData.assignedTo = null;
        }
        
        console.log('assignedTo value:', updateData.assignedTo);
        
        console.log('Update data prepared:', JSON.stringify(updateData, null, 2));
        console.log('Update data keys:', Object.keys(updateData));
        console.log('Updating task with ID:', taskId);

        // Validate updateData before sending to Prisma
        const finalUpdateData: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(updateData)) {
            if (value !== undefined) {
                finalUpdateData[key] = value;
            }
        }

        console.log('Final update data:', JSON.stringify(finalUpdateData, null, 2));
        console.log('Final update data keys:', Object.keys(finalUpdateData));

        // Build update payload directly - similar to createTask pattern
        const updatePayload: Record<string, unknown> = {
            title: finalUpdateData.title,
            description: finalUpdateData.description,
            status: finalUpdateData.status,
            priority: finalUpdateData.priority,
        };
        
        // Add startDate if it's provided, using the same pattern as createTask
        if (finalUpdateData.startDate !== undefined) {
            if (finalUpdateData.startDate instanceof Date) {
                updatePayload.startDate = finalUpdateData.startDate;
            } else if (finalUpdateData.startDate === null) {
                updatePayload.startDate = null;
            } else {
                // Should not happen, but handle it
                updatePayload.startDate = finalUpdateData.startDate;
            }
            console.log('Adding startDate to update payload:', updatePayload.startDate, 'type:', typeof updatePayload.startDate);
        }
        
        // Add dueDate if it's provided, using the same pattern as createTask
        if (finalUpdateData.dueDate !== undefined) {
            if (finalUpdateData.dueDate instanceof Date) {
                updatePayload.dueDate = finalUpdateData.dueDate;
            } else if (finalUpdateData.dueDate === null) {
                updatePayload.dueDate = null;
            } else {
                // Should not happen, but handle it
                updatePayload.dueDate = finalUpdateData.dueDate;
            }
            console.log('Adding dueDate to update payload:', updatePayload.dueDate, 'type:', typeof updatePayload.dueDate);
        }
        
        // Add assignedTo if it's provided
        if (finalUpdateData.assignedTo !== undefined) {
            updatePayload.assignedTo = finalUpdateData.assignedTo || null;
        }
        
        console.log('Final update payload:', JSON.stringify(updatePayload, null, 2));
        console.log('Final update payload keys:', Object.keys(updatePayload));
        
        const updated = await prisma.task.update({
            where: { id: taskId },
            data: updatePayload,
        });
        
        console.log('Task updated successfully in DB:', updated);
        console.log('Revalidating paths...');
        
        // Revalidate multiple paths to ensure data is refreshed
        revalidatePath(`/dashboard/projects/${projectId}`);
        revalidatePath(`/dashboard/projects`);
        revalidatePath(`/dashboard/projects/${projectId}`, 'page');
        
        console.log('=== updateTask SUCCESS ===');
        return { success: true, message: 'وظیفه با موفقیت بروزرسانی شد.', errors: undefined };
    } catch (error: unknown) {
        console.error('=== updateTask ERROR ===');
        console.error('Error type:', typeof error);
        console.error('Error:', error);

        let errorMessage = 'خطا در بروزرسانی وظیفه';

        if (error) {
            if (typeof error === 'string') {
                errorMessage = error;
            } else if (error instanceof Error) {
                errorMessage = error.message;
                console.error('Error name:', error.name);
                console.error('Error message:', error.message);
                console.error('Error stack:', error.stack);
            } else if (error && typeof error === 'object') {
                if ('message' in error && typeof error.message === 'string') {
                    errorMessage = error.message;
                    console.error('Error message:', error.message);
                }
                if ('name' in error) {
                    console.error('Error name:', error.name);
                }
                if ('code' in error) {
                    console.error('Error code:', error.code);
                }
            }
        }

        return {
            success: false,
            message: `خطا در بروزرسانی وظیفه: ${errorMessage}`,
            errors: undefined
        };
    }
}
