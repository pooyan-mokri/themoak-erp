'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createCustomer } from '@/actions/customer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useEffect } from 'react';
import { toast } from 'sonner';

const initialState = {
  message: '',
  errors: {},
  success: false,
};

interface QuickCustomerFormProps {
  onSuccess: (customerId: string, customerData?: { id: string; name: string }) => void;
  onCancel: () => void;
}

export function QuickCustomerForm({ onSuccess, onCancel }: QuickCustomerFormProps) {
  // @ts-ignore
  const [state, dispatch] = useFormState(createCustomer, initialState);

  useEffect(() => {
    if (state.success && state.message) {
      // Pass customerId and customer data if available
      const customerId = (state as any).customerId || '';
      const customerData = (state as any).customer || undefined;
      onSuccess(customerId, customerData); 
    } else if (state.message && !state.success) {
      toast.error(state.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success, state.message]);

  return (
    <form action={dispatch} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">نام مشتری</Label>
        <Input id="name" name="name" required placeholder="نام و نام خانوادگی" />
        {state.errors?.name && <p className="text-red-500 text-sm">{state.errors.name}</p>}
      </div>
      
      <div className="space-y-2">
        <Label htmlFor="phone">شماره تماس</Label>
        <Input id="phone" name="phone" placeholder="0912..." />
        {state.errors?.phone && <p className="text-red-500 text-sm">{state.errors.phone}</p>}
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>انصراف</Button>
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'در حال ثبت...' : 'ثبت مشتری'}
    </Button>
  );
}
