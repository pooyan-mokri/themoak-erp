'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateCurrencyExchange } from '@/actions/currency-exchange';
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
import { Currency } from '@/lib/types';

interface Account {
  id: string;
  name: string;
  currency: Currency;
  cardNumber?: string | null;
}

interface Exchange {
  id: string;
  date: Date;
  sourceAccountId: string | null;
  targetAccountId: string | null;
  sourceAmount: number | null;
  targetAmount: number | null;
  exchangeRate: number;
  description?: string;
}

/** Correcting a wrongly recorded exchange: the balances follow the new numbers. */
export function CurrencyExchangeEditDialog({ exchange, accounts }: { exchange: Exchange; accounts: Account[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [sourceAccountId, setSourceAccountId] = useState(exchange.sourceAccountId ?? '');
  const [targetAccountId, setTargetAccountId] = useState(exchange.targetAccountId ?? '');
  const [sourceAmount, setSourceAmount] = useState(exchange.sourceAmount === null ? '' : String(exchange.sourceAmount));
  const [targetAmount, setTargetAmount] = useState(exchange.targetAmount === null ? '' : String(exchange.targetAmount));
  const [exchangeRate, setExchangeRate] = useState(String(exchange.exchangeRate));
  const [date, setDate] = useState<Date>(new Date(exchange.date));
  const [description, setDescription] = useState(exchange.description ?? '');

  const sourceAccount = accounts.find((a) => a.id === sourceAccountId);
  const targetAccount = accounts.find((a) => a.id === targetAccountId);
  // The rate is always Toman for 1 unit of the foreign currency, as on the record form.
  const hasTomanSide =
    (sourceAccount?.currency === Currency.TOMAN) !== (targetAccount?.currency === Currency.TOMAN);
  const tomanAmount = sourceAccount?.currency === Currency.TOMAN ? sourceAmount : targetAmount;
  const foreignAmount = sourceAccount?.currency === Currency.TOMAN ? targetAmount : sourceAmount;

  /** Keep the rate honest: it is the two amounts divided, whenever one side is Toman. */
  const rateFromAmounts = (toman: string, foreign: string) => {
    const t = Number(toman);
    const f = Number(foreign);
    return t > 0 && f > 0 ? String(Number((t / f).toFixed(2))) : '';
  };

  const changeAmount = (side: 'source' | 'target', value: string) => {
    const nextSource = side === 'source' ? value : sourceAmount;
    const nextTarget = side === 'target' ? value : targetAmount;
    if (side === 'source') setSourceAmount(value);
    else setTargetAmount(value);
    if (!hasTomanSide) return;
    const toman = sourceAccount?.currency === Currency.TOMAN ? nextSource : nextTarget;
    const foreign = sourceAccount?.currency === Currency.TOMAN ? nextTarget : nextSource;
    const rate = rateFromAmounts(toman, foreign);
    if (rate) setExchangeRate(rate);
  };

  const handleSave = async () => {
    if (!sourceAccount || !targetAccount) {
      toast.error('حساب مبدا و مقصد را انتخاب کنید.');
      return;
    }
    setSaving(true);
    const result = await updateCurrencyExchange({
      id: exchange.id,
      sourceAccountId,
      targetAccountId,
      sourceAmount: Number(sourceAmount),
      targetAmount: Number(targetAmount),
      sourceCurrency: sourceAccount.currency,
      targetCurrency: targetAccount.currency,
      exchangeRate: Number(exchangeRate),
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
          <DialogTitle className="text-right">ویرایش معامله ارز</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            با ذخیره، مبلغ‌های قبلی از حساب‌ها برداشته و مبلغ‌های جدید اعمال می‌شود.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>حساب مبدا (برداشت از)</Label>
              <Select value={sourceAccountId} onValueChange={setSourceAccountId}>
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
              <Label>حساب مقصد (واریز به)</Label>
              <Select value={targetAccountId} onValueChange={setTargetAccountId}>
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
              <Label>مبلغ {sourceAccount?.currency ?? 'مبدا'}</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={sourceAmount}
                onChange={(e) => changeAmount('source', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>مبلغ {targetAccount?.currency ?? 'مقصد'}</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={targetAmount}
                onChange={(e) => changeAmount('target', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>نرخ تبدیل</Label>
              <Input
                type="number"
                step="0.000001"
                min="0.01"
                value={exchangeRate}
                onChange={(e) => setExchangeRate(e.target.value)}
              />
              {hasTomanSide && tomanAmount && foreignAmount && (
                <p className="text-xs text-muted-foreground">
                  تومان به ازای هر ۱ {sourceAccount?.currency === Currency.TOMAN ? targetAccount?.currency : sourceAccount?.currency}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>تاریخ</Label>
              <JalaliDatePicker
                name="date"
                defaultValue={date}
                onChange={(selected) => selected && setDate(selected)}
              />
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
