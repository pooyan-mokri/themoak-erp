'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createSupplier } from '@/actions/supplier';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

const initialState: any = {
  success: false,
  message: '',
  error: '',
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'در حال ثبت...' : 'ثبت تامین‌کننده'}
    </Button>
  );
}

export function SupplierForm() {
  const [state, formAction] = useFormState(createSupplier, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>افزودن تامین‌کننده جدید</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          {state?.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          {state?.success && (
            <Alert className="bg-green-50 text-green-900 border-green-200">
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">نام تامین‌کننده</Label>
            <Input id="name" name="name" placeholder="مثال: شرکت پخش نمونه" required />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">تلفن تماس</Label>
              <Input id="phone" name="phone" placeholder="۰۲۱..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">ایمیل</Label>
              <Input id="email" name="email" type="email" placeholder="info@example.com" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">آدرس</Label>
            <Input id="address" name="address" placeholder="تهران، خیابان..." />
          </div>

          <SubmitButton />
        </form>
      </CardContent>
    </Card>
  );
}
