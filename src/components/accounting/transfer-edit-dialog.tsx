'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateInternalTransfer } from '@/actions/accounting';
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
import { accountLabel } from '@/lib/account-label';

interface Account {
  id: string;
  name: string;
  currency: string;
  cardNumber?: string | null;
}

interface Transfer {
  id: string;
  date: Date;
  fromAccountId: string | null;
  toAccountId: string | null;
  amount: number;
  description: string;
}

/** Correcting a wrongly recorded transfer: the balances follow the new figures. */
export function TransferEditDialog({ transfer, accounts }: { transfer: Transfer; accounts: Account[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [fromAccountId, setFromAccountId] = useState(transfer.fromAccountId ?? '');
  const [toAccountId, setToAccountId] = useState(transfer.toAccountId ?? '');
  const [amount, setAmount] = useState(String(transfer.amount));
  const [date, setDate] = useState<Date>(new Date(transfer.date));
  const [description, setDescription] = useState(transfer.description);

  const fromAccount = accounts.find((a) => a.id === fromAccountId);
  // As on the record form: only between accounts of one currency.
  const targets = accounts.filter((a) => a.id !== fromAccountId && (!fromAccount || a.currency === fromAccount.currency));

  const handleSave = async () => {
    if (!fromAccountId || !toAccountId) {
      toast.error('حساب مبدأ و مقصد را انتخاب کنید.');
      return;
    }
    setSaving(true);
    const result = await updateInternalTransfer({
      id: transfer.id,
      fromAccountId,
      toAccountId,
      amount: Number(amount),
      date: date.toISOString(),
      description: description.trim() || undefined,
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
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-right">ویرایش انتقال وجه</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            با ذخیره، مبلغ قبلی به حساب‌ها برمی‌گردد و مبلغ جدید اعمال می‌شود.
          </p>
          <div className="space-y-2">
            <Label>حساب مبدأ</Label>
            <Select
              value={fromAccountId}
              onValueChange={(value) => {
                setFromAccountId(value);
                const next = accounts.find((a) => a.id === value);
                if (accounts.find((a) => a.id === toAccountId)?.currency !== next?.currency) setToAccountId('');
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="انتخاب حساب" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {accountLabel(account)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>حساب مقصد</Label>
            <Select value={toAccountId} onValueChange={setToAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="انتخاب حساب" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {accountLabel(account)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>مبلغ {fromAccount ? `(${fromAccount.currency})` : ''}</Label>
              <Input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>تاریخ</Label>
              <JalaliDatePicker name="date" defaultValue={date} onChange={(selected) => selected && setDate(selected)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>توضیحات</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            انصراف
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
