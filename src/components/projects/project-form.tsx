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
}

export function ProjectForm({ project, trigger }: ProjectFormProps) {
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
            <Plus className="ml-2 h-4 w-4" />
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
              <p className="text-sm text-red-500">{(state.errors as Record<string, string[] | undefined> | undefined)?.name?.[0]}</p>
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

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="startDate">تاریخ شروع</Label>
              <Input 
                id="startDate" 
                name="startDate" 
                type="date" 
                defaultValue={project?.startDate ? new Date(project.startDate).toISOString().split('T')[0] : ''}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="endDate">تاریخ پایان</Label>
              <Input 
                id="endDate" 
                name="endDate" 
                type="date" 
                defaultValue={project?.endDate ? new Date(project.endDate).toISOString().split('T')[0] : ''}
              />
            </div>
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
          </div>

          <DialogFooter>
            <SubmitButton isEditing={!!project} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
