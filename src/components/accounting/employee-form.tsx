'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createEmployee, updateEmployee } from '@/actions/employee';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { useEffect, useState, useRef } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

const initialState = {
  message: '',
  errors: {},
  success: false,
};

interface EmployeeFormProps {
  initialData?: any;
  onSuccess?: () => void;
}

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

  return (
    <Card className={initialData ? 'border-0 shadow-none' : ''}>
      {!initialData && (
        <CardHeader>
          <CardTitle>تعریف کارمند جدید</CardTitle>
        </CardHeader>
      )}
      <form action={dispatch} key={initialData ? initialData.id : state.success ? Date.now() : 'new'}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">نام کارمند *</Label>
            <Input
              id="name"
              name="name"
              placeholder="مثال: علی احمدی"
              required
              defaultValue={initialData?.name}
            />
            {(state.errors as Record<string, string[] | undefined> | undefined)?.name && (
              <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.name[0]}</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nationalId">کد ملی</Label>
              <Input
                id="nationalId"
                name="nationalId"
                placeholder="1234567890"
                defaultValue={initialData?.nationalId || ''}
              />
              {(state.errors as Record<string, string[] | undefined> | undefined)?.nationalId && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.nationalId[0]}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">شماره تماس</Label>
              <Input
                id="phone"
                name="phone"
                placeholder="09123456789"
                defaultValue={initialData?.phone || ''}
              />
              {(state.errors as Record<string, string[] | undefined> | undefined)?.phone && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.phone[0]}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">ایمیل</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="example@email.com"
              defaultValue={initialData?.email || ''}
            />
            {(state.errors as Record<string, string[] | undefined> | undefined)?.email && (
              <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.email[0]}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="position">سمت</Label>
            <Input
              id="position"
              name="position"
              placeholder="مثال: حسابدار"
              defaultValue={initialData?.position || ''}
            />
            {(state.errors as Record<string, string[] | undefined> | undefined)?.position && (
              <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.position[0]}</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="salary">حقوق ماهانه (تومان) *</Label>
              <Input
                id="salary"
                name="salary"
                type="number"
                step="0.01"
                min="0"
                placeholder="0"
                required
                defaultValue={initialData?.salary?.toString() || ''}
              />
              {(state.errors as Record<string, string[] | undefined> | undefined)?.salary && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.salary[0]}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="hireDate">تاریخ استخدام</Label>
              <JalaliDatePicker
                name="hireDate"
                defaultValue={initialData?.hireDate ? new Date(initialData.hireDate) : undefined}
                onChange={(selectedDate) => {
                  setHireDate(selectedDate ? selectedDate.toISOString().split('T')[0] : '');
                }}
              />
              <input type="hidden" name="hireDate" value={hireDate} />
              {(state.errors as Record<string, string[] | undefined> | undefined)?.hireDate && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.hireDate[0]}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">آدرس</Label>
            <Textarea
              id="address"
              name="address"
              placeholder="آدرس..."
              rows={3}
              defaultValue={initialData?.address || ''}
            />
            {(state.errors as Record<string, string[] | undefined> | undefined)?.address && (
              <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.address[0]}</p>
            )}
          </div>

          {state.message && (
            <div
              className={`text-sm p-3 rounded ${
                state.success
                  ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200'
                  : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200'
              }`}
            >
              {state.message}
            </div>
          )}
        </CardContent>
        {!initialData && (
          <CardFooter className="flex justify-end">
            <SubmitButton />
          </CardFooter>
        )}
        {initialData && (
          <div className="px-6 pb-6 flex justify-end">
            <SubmitButton />
          </div>
        )}
      </form>
    </Card>
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

