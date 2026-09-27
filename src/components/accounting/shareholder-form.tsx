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
  /** Inside a dialog: no card of its own. */
  bare?: boolean;
}

export function ShareholderForm({ initialData, onSuccess, bare = false }: ShareholderFormProps) {
  const plain = !!initialData || bare;
  const updateShareholderWithId = initialData
    ? updateShareholder.bind(null, initialData.id)
    : undefined;
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
    <Card className={plain ? 'border-0 shadow-none' : ''}>
      {!plain && (
        <CardHeader>
          <CardTitle>تعریف صاحب سهام جدید</CardTitle>
        </CardHeader>
      )}
      <form action={dispatch}>
        <CardContent className={plain ? 'space-y-4 px-0' : 'space-y-4'}>
          <div className="space-y-2">
            <Label htmlFor="name">نام صاحب سهام *</Label>
            <Input
              id="name"
              name="name"
              placeholder="مثال: علی احمدی"
              required
              defaultValue={initialData?.name}
            />
            {(state.errors as Record<string, string[] | undefined> | undefined)?.name && (
              <p className="text-[12.5px] text-danger">{(state.errors as Record<string, string[] | undefined> | undefined)?.name?.[0]}</p>
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
            {(state.errors as Record<string, string[] | undefined> | undefined)?.percentage && (
              <p className="text-[12.5px] text-danger">{(state.errors as Record<string, string[] | undefined> | undefined)?.percentage?.[0]}</p>
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
              {(state.errors as Record<string, string[] | undefined> | undefined)?.phone && (
                <p className="text-[12.5px] text-danger">{(state.errors as Record<string, string[] | undefined> | undefined)?.phone?.[0]}</p>
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
              {(state.errors as Record<string, string[] | undefined> | undefined)?.email && (
                <p className="text-[12.5px] text-danger">{(state.errors as Record<string, string[] | undefined> | undefined)?.email?.[0]}</p>
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
            {(state.errors as Record<string, string[] | undefined> | undefined)?.address && (
              <p className="text-[12.5px] text-danger">{(state.errors as Record<string, string[] | undefined> | undefined)?.address?.[0]}</p>
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
            {(state.errors as Record<string, string[] | undefined> | undefined)?.notes && (
              <p className="text-[12.5px] text-danger">{(state.errors as Record<string, string[] | undefined> | undefined)?.notes?.[0]}</p>
            )}
          </div>

          {state.message && (
            <div
              className={`rounded-md px-3 py-2 text-[13px] ${state.success ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}
            >
              {state.message}
            </div>
          )}
        </CardContent>
        <CardFooter className={plain ? 'flex justify-end px-0' : 'flex justify-end'}>
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

