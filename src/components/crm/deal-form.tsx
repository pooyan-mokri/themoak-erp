'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createDeal } from '@/actions/crm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

const initialState: {
  errors?: Record<string, string[]>;
  message: string;
  success?: boolean;
} = {
  message: '',
};

interface DealFormProps {
  customers: Array<{ id: string; name: string }>;
}

export function DealForm({ customers }: DealFormProps) {
  const router = useRouter();
  const [state, dispatch] = useFormState(createDeal, initialState);

  useEffect(() => {
    if (state.message && state.success) {
      toast.success(state.message);
      router.push('/dashboard/crm/deals');
    } else if (state.message && !state.success) {
      toast.error(state.message);
    }
  }, [state, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>ایجاد فرصت فروش جدید</CardTitle>
      </CardHeader>
      <form action={dispatch}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">عنوان *</Label>
            <Input id="title" name="title" placeholder="عنوان معامله" required />
            {(state.errors as Record<string, string[] | undefined> | undefined)?.title && <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.title[0]}</p>}
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="customerId">مشتری *</Label>
            <select id="customerId" name="customerId" required className="w-full p-2 border rounded">
              <option value="">انتخاب کنید</option>
              {customers.map(customer => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
            {(state.errors as Record<string, string[] | undefined> | undefined)?.customerId && <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.customerId[0]}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="value">ارزش (تومان) *</Label>
              <Input id="value" name="value" type="number" placeholder="0" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="probability">احتمال برد (%) *</Label>
              <Input id="probability" name="probability" type="number" min="0" max="100" defaultValue="25" required />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="expectedClose">تاریخ پیش‌بینی شده بسته شدن</Label>
            <Input id="expectedClose" name="expectedClose" type="date" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">یادداشت‌ها</Label>
            <Textarea id="notes" name="notes" placeholder="یادداشت‌ها..." rows={3} />
          </div>
        </CardContent>
        <CardFooter className="flex justify-end">
          <SubmitButton />
        </CardFooter>
      </form>
    </Card>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'در حال ایجاد...' : 'ایجاد فرصت'}
    </Button>
  );
}
