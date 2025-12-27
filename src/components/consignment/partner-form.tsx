'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createConsignmentPartner } from '@/actions/consignment';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

const initialState = {
  message: '',
  errors: {},
};

export function PartnerForm() {
  const [state, dispatch] = useFormState(createConsignmentPartner, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>تعریف همکار امانی جدید</CardTitle>
      </CardHeader>
      <form action={dispatch}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">نام همکار / فروشگاه</Label>
            <Input id="name" name="name" placeholder="مثال: گالری نور" required />
            {(state.errors as Record<string, string[] | undefined> | undefined)?.name && <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.name}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">شماره تماس</Label>
            <Input id="phone" name="phone" placeholder="0912..." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">آدرس</Label>
            <Textarea id="address" name="address" placeholder="آدرس کامل..." />
          </div>
          <div className="space-y-2">
            <Label htmlFor="commissionRate">
              درصد کمیسیون (۰ تا ۱۰۰)
            </Label>
            <Input
              id="commissionRate"
              name="commissionRate"
              type="number"
              min="0"
              max="100"
              step="0.1"
              placeholder="مثال: 15"
            />
            <p className="text-xs text-muted-foreground">
              درصد کمیسیون که به ازای هر فروش به این همکار پرداخت می‌شود
            </p>
            {(state.errors as Record<string, string[] | undefined> | undefined)?.commissionRate && (
              <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.commissionRate}</p>
            )}
          </div>
          {state.message && (
            <div className={`text-sm p-2 rounded ${state.message.includes('موفقیت') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
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
      {pending ? 'در حال ثبت...' : 'ثبت همکار'}
    </Button>
  );
}
