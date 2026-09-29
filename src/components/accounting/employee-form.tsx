'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createEmployee, updateEmployee } from '@/actions/employee';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { useEffect, useState, useRef } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { localDateString } from '@/lib/date-utils';

const initialState = {
  message: '',
  errors: {},
  success: false,
};

interface EmployeeFormProps {
  initialData?: any;
  onSuccess?: () => void;
}

/** New employee or an edit; shown inside a dialog, which carries the title. */
export function EmployeeForm({ initialData, onSuccess }: EmployeeFormProps) {
  const router = useRouter();
  const updateEmployeeWithId = initialData
    ? updateEmployee.bind(null, initialData.id)
    : undefined;
  const action = initialData ? updateEmployeeWithId : createEmployee;

  // @ts-ignore
  const [state, dispatch] = useFormState(action, initialState);
  const [hireDate, setHireDate] = useState<string>(initialData?.hireDate ? new Date(initialData.hireDate).toISOString().split('T')[0] : '');
  const lastMessageRef = useRef<string>('');

  useEffect(() => {
    // Only process if message has changed
    if (state.message && state.message !== lastMessageRef.current) {
      lastMessageRef.current = state.message;

      if (state.success) {
        toast.success(state.message);
        if (onSuccess) {
          onSuccess();
        } else if (!initialData) {
          // If creating new employee (not editing) and no onSuccess callback, refresh the page
          router.refresh();
        }
        // Reset form state when creating new employee
        if (!initialData) {
          setHireDate('');
        }
      } else {
        toast.error(state.message);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.message, state.success]);

  const errors = state.errors as Record<string, string[] | undefined> | undefined;
  const FieldError = ({ name }: { name: string }) =>
    errors?.[name] ? <p className="text-[12.5px] text-danger">{errors[name]?.[0]}</p> : null;

  return (
    <form action={dispatch} key={initialData ? initialData.id : state.success ? Date.now() : 'new'} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">نام کارمند *</Label>
        <Input id="name" name="name" placeholder="مثال: علی احمدی" required defaultValue={initialData?.name} />
        <FieldError name="name" />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="nationalId">کد ملی</Label>
          <Input id="nationalId" name="nationalId" placeholder="1234567890" className="font-mono" dir="ltr" defaultValue={initialData?.nationalId || ''} />
          <FieldError name="nationalId" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="phone">شماره تماس</Label>
          <Input id="phone" name="phone" placeholder="09123456789" className="font-mono" dir="ltr" defaultValue={initialData?.phone || ''} />
          <FieldError name="phone" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="email">ایمیل</Label>
          <Input id="email" name="email" type="email" placeholder="example@email.com" dir="ltr" defaultValue={initialData?.email || ''} />
          <FieldError name="email" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="position">سمت</Label>
          <Input id="position" name="position" placeholder="مثال: حسابدار" defaultValue={initialData?.position || ''} />
          <FieldError name="position" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="salary">حقوق ماهانه (تومان) *</Label>
          <Input
            id="salary"
            name="salary"
            type="number"
            step="0.01"
            min="0"
            placeholder="0"
            required
            className="tabular-nums"
            defaultValue={initialData?.salary?.toString() || ''}
          />
          <FieldError name="salary" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="hireDate">تاریخ استخدام</Label>
          <JalaliDatePicker
            name="hireDate"
            defaultValue={initialData?.hireDate ? new Date(initialData.hireDate) : undefined}
            onChange={(selectedDate) => {
              setHireDate(selectedDate ? localDateString(selectedDate) : '');
            }}
          />
          <input type="hidden" name="hireDate" value={hireDate} />
          <FieldError name="hireDate" />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="address">آدرس</Label>
        <Textarea id="address" name="address" placeholder="آدرس..." rows={3} defaultValue={initialData?.address || ''} />
        <FieldError name="address" />
      </div>

      {state.message && (
        <div
          className={cn(
            'rounded-md px-3 py-2 text-[13px]',
            state.success ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
          )}
        >
          {state.message}
        </div>
      )}

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'در حال ثبت...' : 'ثبت'}
    </Button>
  );
}
