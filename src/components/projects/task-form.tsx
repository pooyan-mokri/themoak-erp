'use client';

import { createTask, updateTask } from '@/actions/project';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { Plus } from 'lucide-react';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';

type State = {
  success?: boolean;
  message?: string;
  errors?: {
    title?: string[];
    description?: string[];
    status?: string[];
    priority?: string[];
    dueDate?: string[];
    projectId?: string[];
    assignedTo?: string[];
  };
};

const initialState: State = {
  success: false,
  message: '',
  errors: undefined,
};

function SubmitButton({ isEditing, pending }: { isEditing: boolean; pending: boolean }) {
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'در حال ثبت...' : isEditing ? 'بروزرسانی وظیفه' : 'ایجاد وظیفه'}
    </Button>
  );
}

interface TaskFormProps {
  projectId: string;
  task?: any;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  users?: Array<{ id: string; name: string; email: string }>;
}

export function TaskForm({ projectId, task, trigger, open: controlledOpen, onOpenChange, users = [] }: TaskFormProps) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const [assignedTo, setAssignedTo] = useState<string>(task?.assignedTo || '');
  const [priority, setPriority] = useState<string>(task?.priority || 'MEDIUM');
  const [status, setStatus] = useState<string>(task?.status || 'TODO');
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<any>({});
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;
  
  // Update state when task changes or dialog opens
  // Use task?.id as dependency to avoid infinite loops when task object reference changes
  useEffect(() => {
    if (open && task) {
      console.log('TaskForm: task received:', task);
      console.log('TaskForm: task.id:', task.id);
      // assignedTo should be user ID, not user name
      setAssignedTo(task.assignedTo || '');
      setPriority(task.priority || 'MEDIUM');
      setStatus(task.status || 'TODO');
    }
  }, [open, task?.id]);
  
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPending(true);
    setErrors({});
    
    const formData = new FormData(e.currentTarget);
    
    // Ensure all form values are included
    formData.set('priority', priority);
    formData.set('status', status);
    // assignedTo should be user ID, not user name
    formData.set('assignedTo', assignedTo || '');
    
    // Client-side date validation: startDate must be <= dueDate when both exist
    const startDateValue = formData.get('startDate') as string | null;
    const dueDateValue = formData.get('dueDate') as string | null;
    
    console.log('Date validation check:', {
      startDateValue,
      dueDateValue,
      startDateTrimmed: startDateValue?.trim(),
      dueDateTrimmed: dueDateValue?.trim(),
    });
    
    if (startDateValue && startDateValue.trim() && dueDateValue && dueDateValue.trim()) {
      const start = new Date(startDateValue);
      const due = new Date(dueDateValue);
      console.log('Parsed dates:', { start, due, startTime: start.getTime(), dueTime: due.getTime() });
      
      if (!isNaN(start.getTime()) && !isNaN(due.getTime())) {
        if (start > due) {
          console.log('Validation failed: startDate > dueDate');
          toast.error('تاریخ شروع باید قبل از تاریخ سررسید باشد.');
          setPending(false);
          return;
        }
      }
    }
    
    console.log('=== handleSubmit START ===');
    console.log('task object:', task);
    console.log('task?.id:', task?.id);
    console.log('hasTask:', !!task);
    console.log('FormData values:', {
      title: formData.get('title'),
      description: formData.get('description'),
      status: formData.get('status'),
      priority: formData.get('priority'),
      startDate: formData.get('startDate'),
      dueDate: formData.get('dueDate'),
      projectId: formData.get('projectId'),
      assignedTo: formData.get('assignedTo'),
    });
    
    try {
      let result;
      
      // Double check task.id exists
      if (!task) {
        console.log('>>> No task object - Calling createTask');
        result = await createTask({} as any, formData);
        console.log('<<< createTask returned:', result);
      } else if (!task.id) {
        console.error('>>> ERROR: task exists but task.id is missing!', task);
        toast.error('خطا: شناسه وظیفه یافت نشد');
        setPending(false);
        return;
      } else {
        console.log('>>> Calling updateTask with taskId:', task.id);
        console.log('>>> Full task object:', JSON.stringify(task, null, 2));
        result = await updateTask(task.id, {} as any, formData);
        console.log('<<< updateTask returned:', result);
      }
      
      console.log('handleSubmit result:', result);
      console.log('result.success:', result?.success);
      
      if (result?.success) {
        console.log('SUCCESS - Closing dialog and refreshing');
        setOpen(false);
        toast.success(result.message || (task ? 'وظیفه بروزرسانی شد' : 'وظیفه ایجاد شد'));
        // Refresh the page to show updated data
        router.refresh();
        // Reset form
        if (!task) {
          e.currentTarget.reset();
          setAssignedTo('');
          setPriority('MEDIUM');
          setStatus('TODO');
        }
      } else {
        console.error('FAILED - Task update/create failed:', result);
        if (result?.errors) {
          setErrors(result.errors);
          console.error('Validation errors:', result.errors);
        }
        if (result?.message) {
          toast.error(result.message);
        } else {
          toast.error('خطا در ثبت وظیفه');
        }
      }
    } catch (error: any) {
      console.error('EXCEPTION in handleSubmit');
      console.error('Error type:', typeof error);
      if (error) {
        try {
          console.error('Error:', error);
          if (error.message) console.error('Error message:', error.message);
          if (error.name) console.error('Error name:', error.name);
          if (error.stack) console.error('Error stack:', error.stack);
        } catch (e) {
          console.error('Could not log error details');
        }
      }
      toast.error('خطا در ثبت وظیفه. لطفا دوباره تلاش کنید.');
    } finally {
      setPending(false);
      console.log('=== handleSubmit END ===');
    }
  };

  // If controlled (open prop provided), don't use DialogTrigger
  const isControlled = controlledOpen !== undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          {trigger || (
            <Button size="sm">
              <Plus className="ml-2 h-4 w-4" />
              وظیفه جدید
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{task ? 'ویرایش وظیفه' : 'ایجاد وظیفه جدید'}</DialogTitle>
          <DialogDescription>
            مشخصات وظیفه را وارد کنید.
          </DialogDescription>
        </DialogHeader>
        <form key={task?.id || 'new'} onSubmit={handleSubmit} className="space-y-4">
          <input type="hidden" name="projectId" value={projectId} />
          
          <div className="grid gap-2">
            <Label htmlFor="title">عنوان وظیفه</Label>
            <Input 
              id="title" 
              name="title" 
              defaultValue={task?.title} 
              placeholder="مثال: طراحی صفحه اصلی" 
              required 
            />
            {errors?.title && (
              <p className="text-sm text-red-500">{errors.title[0]}</p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description">توضیحات</Label>
            <Textarea 
              id="description" 
              name="description" 
              defaultValue={task?.description} 
              placeholder="توضیحات تکمیلی..." 
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="priority">اولویت</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب اولویت" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">پایین</SelectItem>
                  <SelectItem value="MEDIUM">متوسط</SelectItem>
                  <SelectItem value="HIGH">بالا</SelectItem>
                  <SelectItem value="URGENT">فوری</SelectItem>
                </SelectContent>
              </Select>
              <input type="hidden" name="priority" value={priority} />
            </div>
            <div className="grid gap-2">
              <JalaliDatePicker
                key={`dueDate-${task?.id || 'new'}`}
                name="dueDate"
                label="تاریخ سررسید"
                defaultValue={task?.dueDate ? new Date(task.dueDate) : null}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <JalaliDatePicker
              key={`startDate-${task?.id || 'new'}`}
              name="startDate"
              label="تاریخ شروع (اختیاری)"
              defaultValue={task?.startDate ? new Date(task.startDate) : null}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="status">وضعیت</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="انتخاب وضعیت" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODO">برای انجام</SelectItem>
                <SelectItem value="IN_PROGRESS">در حال انجام</SelectItem>
                <SelectItem value="REVIEW">در حال بررسی</SelectItem>
                <SelectItem value="DONE">انجام شده</SelectItem>
              </SelectContent>
            </Select>
            <input type="hidden" name="status" value={status} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="assignedTo">محول شده به (اختیاری)</Label>
            {users.length > 0 ? (
              <Select value={assignedTo || undefined} onValueChange={(value) => setAssignedTo(value || '')}>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب کاربر" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name} ({user.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input 
                id="assignedTo" 
                name="assignedTo" 
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                placeholder="نام فرد محول شده" 
              />
            )}
            <input type="hidden" name="assignedTo" value={assignedTo} />
            {errors?.assignedTo && (
              <p className="text-sm text-red-500">{errors.assignedTo[0]}</p>
            )}
          </div>

          <DialogFooter>
            <SubmitButton isEditing={!!task} pending={pending} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
