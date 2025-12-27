'use client';

import { useState, useEffect, useRef } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { payEmployeeDebt } from '@/actions/accounting';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { toast } from 'sonner';

const initialState = {
  message: '',
  errors: {},
  success: false,
};

interface Employee {
  id: string;
  name: string;
}

interface Account {
  id: string;
  name: string;
  currency: string;
}

interface PayDebtDialogProps {
  employee: Employee;
  accounts: Account[];
  isOpen: boolean;
  onClose: () => void;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'در حال ثبت...' : 'ثبت بازپرداخت'}
    </Button>
  );
}

export function PayDebtDialog({ employee, accounts, isOpen, onClose }: PayDebtDialogProps) {
  const router = useRouter();
  const [state, dispatch] = useFormState(payEmployeeDebt, initialState);
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const lastMessageRef = useRef('');

  useEffect(() => {
    if (state.message && state.message !== lastMessageRef.current) {
      lastMessageRef.current = state.message;
      
      if (state.success) {
        toast.success(state.message);
        onClose();
        router.refresh();
      } else {
        toast.error(state.message);
      }
    }
  }, [state.message, state.success, onClose, router]);

  const handleClose = () => {
    setAmount('');
    setAccountId('');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>بازپرداخت بدهی - {employee.name}</DialogTitle>
        </DialogHeader>
        <form action={dispatch}>
          <input type="hidden" name="employeeId" value={employee.id} />
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="amount">مبلغ بازپرداخت (تومان)</Label>
              <Input
                id="amount"
                name="amount"
                type="number"
                placeholder="0"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              {(state.errors as Record<string, string[] | undefined> | undefined)?.amount && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.amount[0]}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="accountId">حساب پرداخت</Label>
              <Select
                required
                value={accountId}
                onValueChange={setAccountId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب حساب" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.name} ({acc.currency})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name="accountId" value={accountId} />
              {(state.errors as Record<string, string[] | undefined> | undefined)?.accountId && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.accountId[0]}</p>
              )}
            </div>

            <div className="space-y-2">
              <JalaliDatePicker
                name="date"
                label="تاریخ بازپرداخت"
                defaultValue={new Date()}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">توضیحات (اختیاری)</Label>
              <Textarea
                id="description"
                name="description"
                placeholder="توضیحات تکمیلی..."
                rows={3}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              انصراف
            </Button>
            <SubmitButton />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

