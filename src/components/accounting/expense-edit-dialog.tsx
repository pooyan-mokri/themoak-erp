'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateExpense } from '@/actions/accounting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

interface Account {
  id: string;
  name: string;
}

interface Expense {
  id: string;
  amount: number;
  currency: string;
  category?: string;
  description?: string;
  date: Date;
  accountId?: string;
  employeeId?: string;
  employee?: { name: string };
}

const CURRENCIES = ['TOMAN', 'USD', 'EUR', 'CNY'];

export function ExpenseEditDialog({ expense, accounts }: { expense: Expense; accounts: Account[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const isAccountPaid = !!expense.accountId;

  const [amount, setAmount] = useState(String(expense.amount));
  const [currency, setCurrency] = useState(expense.currency || 'TOMAN');
  const [category, setCategory] = useState(expense.category || '');
  const [description, setDescription] = useState(expense.description || '');
  const [date, setDate] = useState<Date>(new Date(expense.date));
  const [accountId, setAccountId] = useState(expense.accountId || '');

  const handleSave = async () => {
    if (!amount || Number(amount) <= 0) {
      toast.error('مبلغ باید بیشتر از صفر باشد.');
      return;
    }
    if (!category.trim()) {
      toast.error('دسته‌بندی الزامی است.');
      return;
    }

    setSaving(true);
    const result = await updateExpense({
      id: expense.id,
      amount: Number(amount),
      currency: currency as any,
      category: category.trim(),
      description: description.trim() || undefined,
      date: date.toISOString(),
      accountId: isAccountPaid ? (accountId || undefined) : undefined,
    });
    setSaving(false);

    if (result.success) {
      toast.success(result.message);
      setOpen(false);
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="text-blue-500 hover:text-blue-600 hover:bg-blue-50">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-right">ویرایش هزینه</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>مبلغ</Label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="1"
              />
            </div>
            <div className="space-y-2">
              <Label>ارز</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>دسته‌بندی</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="مثلا: اجاره، حقوق، تبلیغات..." />
          </div>

          <div className="space-y-2">
            <Label>شرح</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>

          <JalaliDatePicker
            name="date"
            label="تاریخ"
            defaultValue={date}
            onChange={(d) => d && setDate(d)}
          />

          {isAccountPaid ? (
            <div className="space-y-2">
              <Label>حساب پرداخت</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب حساب" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                تغییر مبلغ یا حساب، موجودی حساب‌ها را به‌صورت خودکار اصلاح می‌کند.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
              این هزینه توسط کارمند پرداخت شده{expense.employee ? ` (${expense.employee.name})` : ''} و روی موجودی حساب‌ها اثری ندارد.
            </p>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>انصراف</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
