'use client';

import { createProject, updateProject } from '@/actions/project';
import { Button } from '@/components/ui/button';
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
import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { toast } from 'sonner';

type State = {
  success?: boolean;
  message?: string;
  errors?: {
    name?: string[];
    description?: string[];
    status?: string[];
    startDate?: string[];
    endDate?: string[];
    budget?: string[];
  };
};

const initialState: State = {
  success: false,
  message: '',
  errors: undefined,
};

function SubmitButton({ isEditing }: { isEditing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'در حال ثبت...' : isEditing ? 'بروزرسانی پروژه' : 'ایجاد پروژه'}
    </Button>
  );
}

interface ProjectFormProps {
  project?: any;
  trigger?: React.ReactNode;
  /** The budget is finance data (finance.view): without it the field is not shown, and not saved. */
  showBudget?: boolean;
}

export function ProjectForm({ project, trigger, showBudget = false }: ProjectFormProps) {
  const [open, setOpen] = useState(false);
  
  const action = project ? updateProject.bind(null, project.id) : createProject;

  const formAction = async (prevState: any, formData: FormData) => {
    // @ts-ignore
    const result = await action(prevState, formData);
    if (result.success) {
      setOpen(false);
      toast.success(result.message);
    } else if (result.message) {
        toast.error(result.message);
    }
    return result;
  };

  const [state, dispatch] = useFormState(formAction, initialState);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Plus className="h-4 w-4" />
            پروژه جدید
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{project ? 'ویرایش پروژه' : 'ایجاد پروژه جدید'}</DialogTitle>
          <DialogDescription>
            مشخصات پروژه را وارد کنید.
          </DialogDescription>
        </DialogHeader>
        <form action={dispatch} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="name">نام پروژه</Label>
            <Input 
              id="name" 
              name="name" 
              defaultValue={project?.name} 
              placeholder="مثال: راه‌اندازی کمپین تابستانه" 
              required 
            />
            {(state?.errors as Record<string, string[] | undefined> | undefined)?.name && (
              <p className="text-[12.5px] text-danger">{(state.errors as Record<string, string[] | undefined> | undefined)?.name?.[0]}</p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description">توضیحات</Label>
            <Textarea 
              id="description" 
              name="description" 
              defaultValue={project?.description} 
              placeholder="توضیحات تکمیلی درباره پروژه..." 
            />
          </div>

          {/* Jalali pickers, like the task form (these were Gregorian date inputs); each sends an ISO date. */}
          <div className="grid grid-cols-2 gap-4">
            <JalaliDatePicker
              name="startDate"
              label="تاریخ شروع"
              defaultValue={project?.startDate ? new Date(project.startDate) : undefined}
            />
            <JalaliDatePicker
              name="endDate"
              label="تاریخ پایان"
              defaultValue={project?.endDate ? new Date(project.endDate) : undefined}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="status">وضعیت</Label>
              <Select name="status" defaultValue={project?.status || "ACTIVE"}>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب وضعیت" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">فعال</SelectItem>
                  <SelectItem value="ON_HOLD">متوقف شده</SelectItem>
                  <SelectItem value="COMPLETED">تکمیل شده</SelectItem>
                  <SelectItem value="CANCELLED">لغو شده</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {showBudget && (
            <div className="grid gap-2">
              <Label htmlFor="budget">بودجه (تومان)</Label>
              <Input 
                id="budget" 
                name="budget" 
                type="number" 
                defaultValue={project?.budget} 
                placeholder="0" 
              />
            </div>
            )}
          </div>

          <DialogFooter>
            <SubmitButton isEditing={!!project} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
