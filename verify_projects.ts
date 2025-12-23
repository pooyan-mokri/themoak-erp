
import { createProject, createTask, updateTask, getProjectById, getProjects } from './src/actions/project';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function safeAction(action: Function, ...args: any[]) {
  try {
    return await action(...args);
  } catch (error: any) {
    if (error.message.includes('static generation store missing') || error.message === 'NEXT_REDIRECT' || error.digest?.startsWith('NEXT_REDIRECT')) {
      console.log('Ignoring Next.js revalidatePath/redirect error (expected in script)');
      return { success: true, message: 'Action completed (revalidate/redirect skipped)' };
    }
    throw error;
  }
}

async function main() {
  console.log('--- Verifying Project Management ---');

  // 1. Create Project
  console.log('1. Creating Project...');
  const projectFormData = new FormData();
  projectFormData.append('name', 'New Collection Launch');
  projectFormData.append('status', 'ACTIVE');
  
  // We need to mock the state and formData for the server action
  // The action signature is (prevState: any, formData: FormData)
  // But wait, createProject in src/actions/project.ts redirects!
  // This will throw an error in a script. We need to handle that.
  
  // Let's check the action implementation first.
  // If it redirects, we might need to wrap it or just use Prisma directly for setup if testing actions is too hard due to redirects.
  // BUT, we want to test the ACTION logic.
  // Let's try to call it and catch the redirect error (NEXT_REDIRECT).
  
  let projectId: string | undefined;

  try {
    await safeAction(createProject, null, projectFormData);
  } catch (error: any) {
    if (error.message === 'NEXT_REDIRECT') {
      console.log('Project creation redirected (success).');
    } else {
      // It might be the "digest" property for redirects in newer Next.js
      if (error.digest?.startsWith('NEXT_REDIRECT')) {
         console.log('Project creation redirected (success).');
      } else {
         console.error('Error creating project:', error);
      }
    }
  }

  // Verify creation
  const projects = await getProjects();
  const project = projects.find(p => p.name === 'New Collection Launch');
  
  if (!project) {
    throw new Error('Project was not created.');
  }
  projectId = project.id;
  console.log('Project created:', project.name, project.id);

  // 2. Create Task
  console.log('\n2. Creating Task...');
  const taskFormData = new FormData();
  taskFormData.append('title', 'Design Initial Sketches');
  taskFormData.append('status', 'TODO');
  taskFormData.append('assignedTo', 'Designer A');

  const taskResult = await safeAction(createTask, projectId, null, taskFormData);
  console.log('Task Creation Result:', taskResult);

  // Verify Task
  const projectWithTasks = await getProjectById(projectId);
  const task = projectWithTasks?.tasks[0];
  if (!task) throw new Error('Task not created');
  console.log('Task created:', task.title, task.status);

  // 3. Update Task
  console.log('\n3. Updating Task...');
  const updateTaskFormData = new FormData();
  updateTaskFormData.append('title', 'Design Initial Sketches (Updated)');
  updateTaskFormData.append('status', 'IN_PROGRESS');
  updateTaskFormData.append('assignedTo', 'Designer B');

  const updateResult = await safeAction(updateTask, task.id, projectId, null, updateTaskFormData);
  console.log('Task Update Result:', updateResult);

  // Verify Update
  const updatedProject = await getProjectById(projectId);
  const updatedTask = updatedProject?.tasks.find(t => t.id === task.id);
  console.log('Updated Task:', updatedTask?.title, updatedTask?.status);

  if (updatedTask?.status !== 'IN_PROGRESS') throw new Error('Task update failed');

  console.log('\n--- Verification Complete ---');
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
