'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createAccount, updateAccount } from '@/actions/accounting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Currency } from '@/lib/types';
import { useEffect, useState } from 'react';
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

/** Create or edit an account; shown inside a dialog, which carries the title. */
export function AccountForm({ initialData, onSuccess }: AccountFormProps) {
  const updateAccountWithId = initialData ? updateAccount.bind(null, initialData.id) : undefined;
  const action = initialData ? updateAccountWithId : createAccount;

  // @ts-ignore
  const [state, dispatch] = useFormState(action, initialState);
  const [accountType, setAccountType] = useState<string>(initialData?.type || '');
  const errors = state.errors as Record<string, string[] | undefined> | undefined;

  useEffect(() => {
    if (state.message && state.success) {
      toast.success(state.message);
      if (onSuccess) onSuccess();
    } else if (state.message && !state.success) {
      toast.error(state.message);
    }
  }, [state, onSuccess]);

  return (
    <form action={dispatch} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name" className="text-xs text-muted-foreground">نام حساب</Label>
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
        {errors?.name && <p className="text-xs text-danger">{errors.name}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="type" className="text-xs text-muted-foreground">نوع حساب</Label>
          <Select name="type" required defaultValue={initialData?.type} onValueChange={setAccountType}>
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
          {errors?.type && <p className="text-xs text-danger">{errors.type}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="currency" className="text-xs text-muted-foreground">ارز</Label>
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
          {errors?.currency && <p className="text-xs text-danger">{errors.currency}</p>}
        </div>
      </div>

      {/* Only when creating. In edit mode this field re-stamped the running
          balance on every save — even a save meant only to add a card
          number — with no transaction to explain the change. Corrections
          now go through the explicit «اصلاح موجودی» action. */}
      {!initialData && (
        <div className="space-y-1.5">
          <Label htmlFor="initialBalance" className="text-xs text-muted-foreground">موجودی اولیه</Label>
          <Input id="initialBalance" name="initialBalance" type="number" defaultValue="0" dir="ltr" className="text-end tabular-nums" />
          <p className="text-[11.5px] text-muted-foreground">به ارز حساب؛ به‌صورت سند «موجودی اولیه» در دفتر ثبت می‌شود.</p>
        </div>
      )}

      {accountType === 'BANK' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cardNumber" className="text-xs text-muted-foreground">شماره کارت</Label>
            <Input
              id="cardNumber"
              name="cardNumber"
              placeholder="1234-5678-9012-3456"
              maxLength={19}
              defaultValue={initialData?.cardNumber || ''}
              dir="ltr"
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sheba" className="text-xs text-muted-foreground">شماره شبا (IBAN)</Label>
            <Input
              id="sheba"
              name="sheba"
              placeholder="IR123456789012345678901234"
              maxLength={26}
              defaultValue={initialData?.sheba || ''}
              dir="ltr"
              className="font-mono"
            />
          </div>
        </div>
      )}

      {state.message && !state.success && (
        <div className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{state.message}</div>
      )}

      <div className="flex justify-end border-t pt-4">
        <SubmitButton isEdit={!!initialData} />
      </div>
    </form>
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
