'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createCustomer, updateCustomer } from '@/actions/customer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useEffect } from 'react';
import { toast } from 'sonner';

const initialState = {
  message: '',
  errors: {},
  success: false,
};

interface CustomerFormProps {
  initialData?: any;
  onSuccess?: () => void;
}

export function CustomerForm({ initialData, onSuccess }: CustomerFormProps) {
  const updateCustomerWithId = initialData ? updateCustomer.bind(null, initialData.id) : null;
  const action = initialData ? updateCustomerWithId : createCustomer;
  
  // @ts-ignore
  const [state, dispatch] = useFormState(action, initialState);

  useEffect(() => {
    if (state.message && state.success) {
      toast.success(state.message);
      if (onSuccess) onSuccess();
    } else if (state.message && !state.success) {
      toast.error(state.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success, state.message]);

  return (
    <Card className={initialData ? 'border-0 shadow-none' : ''}>
      {!initialData && (
        <CardHeader>
          <CardTitle>ثبت مشتری جدید</CardTitle>
        </CardHeader>
      )}
      <form action={dispatch}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">نام مشتری</Label>
            <Input id="name" name="name" placeholder="مثال: علی رضایی" required defaultValue={initialData?.name} />
            {state.errors?.name && <p className="text-red-500 text-sm">{state.errors.name}</p>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">شماره تماس</Label>
              <Input id="phone" name="phone" placeholder="0912..." defaultValue={initialData?.phone || ''} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">ایمیل</Label>
              <Input id="email" name="email" type="email" placeholder="example@mail.com" defaultValue={initialData?.email || ''} />
              {state.errors?.email && <p className="text-red-500 text-sm">{state.errors.email}</p>}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">آدرس</Label>
            <Textarea id="address" name="address" placeholder="آدرس کامل..." defaultValue={initialData?.address || ''} />
          </div>
          {state.message && !state.success && (
            <div className="text-sm p-2 rounded bg-red-100 text-red-700">
              {state.message}
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-end">
          <SubmitButton isEdit={!!initialData} />
        </CardFooter>
      </form>
    </Card>
  );
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'در حال پردازش...' : (isEdit ? 'ویرایش مشتری' : ' ثبت مشتری')}
    </Button>
  );
}
