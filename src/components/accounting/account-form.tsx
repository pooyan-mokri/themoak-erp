'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createAccount, updateAccount } from '@/actions/accounting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Currency } from '@/lib/types';
import { useEffect } from 'react';
import { toast } from 'sonner';

const initialState = {
  message: '',
  errors: {},
  success: false,
};

interface AccountFormProps {
  initialData?: any;
  onSuccess?: () => void;
}

export function AccountForm({ initialData, onSuccess }: AccountFormProps) {
  const updateAccountWithId = initialData ? updateAccount.bind(null, initialData.id) : null;
  const action = initialData ? updateAccountWithId : createAccount;
  
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
          <CardTitle>تعریف حساب جدید</CardTitle>
        </CardHeader>
      )}
      <form action={dispatch}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">نام حساب</Label>
            <Input 
              id="name" 
              name="name" 
              placeholder="مثال: بانک ملت" 
              required 
              defaultValue={initialData?.name}
              disabled={initialData?.name === 'Marketing Expenses'}
            />
            {initialData?.name === 'Marketing Expenses' && (
              <p className="text-xs text-muted-foreground">این حساب سیستم است و نام آن قابل تغییر نیست.</p>
            )}
            {state.errors?.name && <p className="text-red-500 text-sm">{state.errors.name}</p>}
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="type">نوع حساب</Label>
              <Select name="type" required defaultValue={initialData?.type}>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب کنید" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BANK">بانک</SelectItem>
                  <SelectItem value="CASH">صندوق</SelectItem>
                  <SelectItem value="PERSON">شخص</SelectItem>
                  <SelectItem value="CRYPTO">کیف پول دیجیتال</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="currency">ارز</Label>
              <Select name="currency" required defaultValue={initialData?.currency || "TOMAN"}>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب کنید" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={Currency.TOMAN}>تومان</SelectItem>
                  <SelectItem value={Currency.USD}>دلار</SelectItem>
                  <SelectItem value={Currency.EUR}>یورو</SelectItem>
                  <SelectItem value={Currency.CNY}>یوآن</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="initialBalance">{initialData ? 'موجودی فعلی' : 'موجودی اولیه'}</Label>
            <Input 
              id="initialBalance" 
              name="initialBalance" 
              type="number" 
              defaultValue={initialData?.balance || "0"} 
            />
            {initialData && <p className="text-xs text-muted-foreground text-yellow-600">توجه: تغییر دستی موجودی پیشنهاد نمی‌شود.</p>}
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
      {pending ? 'در حال پردازش...' : (isEdit ? 'ویرایش حساب' : 'ایجاد حساب')}
    </Button>
  );
}
