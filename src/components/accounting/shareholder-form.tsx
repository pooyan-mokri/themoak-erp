'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createShareholder, updateShareholder } from '@/actions/shareholder';
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

interface ShareholderFormProps {
  initialData?: any;
  onSuccess?: () => void;
}

export function ShareholderForm({ initialData, onSuccess }: ShareholderFormProps) {
  const updateShareholderWithId = initialData
    ? updateShareholder.bind(null, initialData.id)
    : null;
  const action = initialData ? updateShareholderWithId : createShareholder;

  // @ts-ignore
  const [state, dispatch] = useFormState(action, initialState);

  useEffect(() => {
    if (state.message && state.success) {
      toast.success(state.message);
      if (onSuccess) onSuccess();
    } else if (state.message && !state.success) {
      toast.error(state.message);
    }
  }, [state, onSuccess]);

  return (
    <Card className={initialData ? 'border-0 shadow-none' : ''}>
      {!initialData && (
        <CardHeader>
          <CardTitle>تعریف صاحب سهام جدید</CardTitle>
        </CardHeader>
      )}
      <form action={dispatch}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">نام صاحب سهام *</Label>
            <Input
              id="name"
              name="name"
              placeholder="مثال: علی احمدی"
              required
              defaultValue={initialData?.name}
            />
            {state.errors?.name && (
              <p className="text-red-500 text-sm">{state.errors.name[0]}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="percentage">درصد سهام *</Label>
            <Input
              id="percentage"
              name="percentage"
              type="number"
              step="0.01"
              min="0"
              max="100"
              placeholder="مثال: 50"
              required
              defaultValue={initialData?.percentage?.toString() || ''}
            />
            {state.errors?.percentage && (
              <p className="text-red-500 text-sm">{state.errors.percentage[0]}</p>
            )}
            <p className="text-xs text-muted-foreground">
              درصد سهام باید بین 0 تا 100 باشد. مجموع درصدهای همه صاحبان سهام نباید بیشتر از 100 باشد.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">تلفن</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                placeholder="09123456789"
                defaultValue={initialData?.phone || ''}
              />
              {state.errors?.phone && (
                <p className="text-red-500 text-sm">{state.errors.phone[0]}</p>
              )}
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
              {state.errors?.email && (
                <p className="text-red-500 text-sm">{state.errors.email[0]}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">آدرس</Label>
            <Textarea
              id="address"
              name="address"
              placeholder="آدرس..."
              rows={2}
              defaultValue={initialData?.address || ''}
            />
            {state.errors?.address && (
              <p className="text-red-500 text-sm">{state.errors.address[0]}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">یادداشت</Label>
            <Textarea
              id="notes"
              name="notes"
              placeholder="یادداشت‌ها..."
              rows={3}
              defaultValue={initialData?.notes || ''}
            />
            {state.errors?.notes && (
              <p className="text-red-500 text-sm">{state.errors.notes[0]}</p>
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
      {pending ? 'در حال ثبت...' : 'ثبت'}
    </Button>
  );
}

