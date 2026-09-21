'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Wrench, CheckCircle2, Landmark, Flag, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { formatJalaliDate } from '@/lib/date-utils';
import { adjustAccountBalance, recordBalanceBaseline, recordBankCheck } from '@/actions/accounting';

type Row = {
  id: string;
  name: string;
  type: string;
  currency: string;
  stored: number;
  computed: number;
  difference: number;
  transactionCount: number;
  lastTransactionAt: Date | string | null;
  lastCheck: { checkedAt: Date | string; bankBalance: number; erpBalance: number; note: string | null } | null;
  changeSinceCheck: number | null;
};

/** The unit a figure is typed in. Toman accounts are the ones a Rial figure gets typed into. */
const unitOf = (currency: string) => (currency === 'TOMAN' ? 'تومان — نه ریال' : currency);

/**
 * Why a new balance needs a second confirmation, or null: about 10× the
 * current balance (a Rial figure typed as Toman), or a large change — more
 * than 10% of the balance or more than 10,000,000.
 *
 * "About 10×" is wide on purpose: a Rial figure is 10× the bank balance, and
 * the balance being corrected is off from the bank too (Saman: 552,687,719
 * Rial typed over 69,634,000 is 7.9×).
 */
export function adjustmentWarning(current: number, next: number, currency: string): string | null {
  const ratio = current !== 0 ? next / current : 0;
  if (ratio >= 5 && ratio <= 20) {
    return currency === 'TOMAN'
      ? 'عدد جدید حدود ۱۰ برابر موجودی فعلی است؛ احتمالاً رقم ریالی وارد شده است. مبلغ باید به تومان باشد (ریال ÷ ۱۰).'
      : 'عدد جدید حدود ۱۰ برابر موجودی فعلی است؛ احتمالاً یک رقم اضافه تایپ شده است.';
  }
  const change = Math.abs(next - current);
  if (change > 10_000_000 || change > Math.abs(current) * 0.1) {
    return 'این تغییر بزرگ است (بیش از ۱۰٪ موجودی یا بیش از ۱۰ میلیون).';
  }
  return null;
}

/** A typed figure, or null while the field is empty or not a number. */
const parseFigure = (value: string) => {
  const n = Number(value);
  return value.trim() !== '' && Number.isFinite(n) ? n : null;
};

export function AccountReconciliation({ rows, isAdmin }: { rows: Row[]; isAdmin: boolean }) {
  const router = useRouter();
  const [target, setTarget] = useState<Row | null>(null);
  const [newBalance, setNewBalance] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checkRow, setCheckRow] = useState<Row | null>(null);
  const [bankFigure, setBankFigure] = useState('');
  const [checkNote, setCheckNote] = useState('');
  const [baselineRow, setBaselineRow] = useState<Row | null>(null);

  const openFix = (row: Row) => {
    setTarget(row);
    // Empty on purpose: the figure is typed from the bank statement, never suggested.
    setNewBalance('');
    setNote('');
    setConfirming(false);
  };

  const openCheck = (row: Row) => {
    setCheckRow(row);
    setBankFigure('');
    setCheckNote('');
  };

  const next = parseFigure(newBalance);
  const warning = target && next !== null ? adjustmentWarning(target.stored, next, target.currency) : null;

  const handleFix = async () => {
    if (!target) return;
    if (next === null) {
      toast.error('موجودی واقعی حساب را از صورتحساب بانک وارد کنید.');
      return;
    }
    if (warning && !confirming) {
      setConfirming(true);
      return;
    }
    setSaving(true);
    const result = await adjustAccountBalance({
      accountId: target.id,
      targetBalance: next,
      note: note.trim() || undefined,
    });
    setSaving(false);
    if (result.success) {
      toast.success(result.message ?? 'اصلاح شد.');
      setTarget(null);
      router.refresh();
    } else {
      toast.error(result.message ?? 'خطا در اصلاح موجودی.');
    }
  };

  const bank = parseFigure(bankFigure);

  const handleCheck = async () => {
    if (!checkRow) return;
    if (bank === null) {
      toast.error('رقم موجودی بانک را وارد کنید.');
      return;
    }
    setSaving(true);
    const result = await recordBankCheck({
      accountId: checkRow.id,
      bankBalance: bank,
      note: checkNote.trim() || undefined,
    });
    setSaving(false);
    if (result.success) {
      toast.success(result.message ?? 'ثبت شد.');
      setCheckRow(null);
      router.refresh();
    } else {
      toast.error(result.message ?? 'خطا در ثبت موجودی بانک.');
    }
  };

  const handleBaseline = async () => {
    if (!baselineRow) return;
    setSaving(true);
    const result = await recordBalanceBaseline(baselineRow.id);
    setSaving(false);
    setBaselineRow(null);
    if (result.success) {
      toast.success(result.message ?? 'ثبت شد.');
      router.refresh();
    } else {
      toast.error(result.message ?? 'خطا در ثبت مانده پایه.');
    }
  };

  const fmt = (n: number) => Math.round(n).toLocaleString('fa-IR');
  const signed = (n: number) => Math.round(n).toLocaleString('fa-IR', { signDisplay: 'exceptZero' });
  const mismatched = rows.filter((r) => Math.abs(r.difference) >= 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-2xl font-bold">{rows.length.toLocaleString('fa-IR')}</div>
            <div className="text-xs text-muted-foreground mt-1">حساب</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <div className={`text-2xl font-bold ${mismatched.length ? 'text-orange-600' : 'text-green-600'}`}>
              {mismatched.length.toLocaleString('fa-IR')}
            </div>
            <div className="text-xs text-muted-foreground mt-1">دارای اختلاف</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">مقایسه موجودی ثبت‌شده با دفتر تراکنش‌ها و بانک</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">حساب</TableHead>
                  <TableHead className="text-right">موجودی ثبت‌شده</TableHead>
                  <TableHead className="text-right">جمع تراکنش‌ها</TableHead>
                  <TableHead className="text-right">اختلاف</TableHead>
                  <TableHead className="text-right">آخرین بررسی بانک</TableHead>
                  <TableHead className="text-right">تراکنش</TableHead>
                  <TableHead className="text-right">آخرین تراکنش</TableHead>
                  {isAdmin && <TableHead className="text-left">عملیات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const off = Math.abs(r.difference) >= 1;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {r.name}
                        <span className="text-xs text-muted-foreground mr-2">({r.currency})</span>
                      </TableCell>
                      <TableCell>{fmt(r.stored)}</TableCell>
                      <TableCell>{fmt(r.computed)}</TableCell>
                      <TableCell>
                        {off ? (
                          <Badge variant="destructive">{fmt(r.difference)}</Badge>
                        ) : (
                          <Badge variant="outline" className="text-green-700">
                            <CheckCircle2 className="h-3 w-3 ml-1" />
                            می‌خواند
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.lastCheck ? (
                          <div className="space-y-0.5 whitespace-nowrap" title={r.lastCheck.note ?? undefined}>
                            <div className="text-muted-foreground">{formatJalaliDate(r.lastCheck.checkedAt)}</div>
                            <div>بانک: {fmt(r.lastCheck.bankBalance)}</div>
                            <div>سیستم در آن زمان: {fmt(r.lastCheck.erpBalance)}</div>
                            <div>
                              اختلاف در آن زمان (سیستم − بانک):{' '}
                              {signed(r.lastCheck.erpBalance - r.lastCheck.bankBalance)}
                            </div>
                            <div>ثبت‌شده در سیستم از آن زمان: {signed(r.changeSinceCheck ?? 0)}</div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.transactionCount.toLocaleString('fa-IR')}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {r.lastTransactionAt ? formatJalaliDate(r.lastTransactionAt) : '—'}
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-left">
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button variant="outline" size="sm" onClick={() => openCheck(r)}>
                              <Landmark className="h-4 w-4 ml-1" />
                              ثبت موجودی بانک
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => openFix(r)}>
                              <Wrench className="h-4 w-4 ml-1" />
                              اصلاح موجودی
                            </Button>
                            {r.difference !== 0 && (
                              <Button variant="outline" size="sm" onClick={() => setBaselineRow(r)}>
                                <Flag className="h-4 w-4 ml-1" />
                                ثبت مانده پایه
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>اصلاح موجودی «{target?.name}»</DialogTitle>
          </DialogHeader>
          {target && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>موجودی واقعی حساب ({unitOf(target.currency)})</Label>
                <Input
                  type="number"
                  value={newBalance}
                  onChange={(e) => {
                    setNewBalance(e.target.value);
                    setConfirming(false);
                  }}
                  placeholder="رقم صورتحساب بانک"
                />
                <p className="text-xs text-muted-foreground">
                  عدد را خودتان از صورتحساب بانک وارد کنید. سند اصلاحی برای تفاوت ثبت می‌شود و رقم بانک هم
                  نگه داشته می‌شود.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">فعلی</div>
                  <div className="font-bold">{fmt(target.stored)}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">جدید</div>
                  <div className="font-bold">{next === null ? '—' : fmt(next)}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">تفاوت</div>
                  <div className="font-bold">{next === null ? '—' : signed(next - target.stored)}</div>
                </div>
              </div>

              {warning && confirming && next !== null && (
                <div className="flex gap-2 rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-200">
                  <AlertTriangle className="h-5 w-5 shrink-0" />
                  <div className="space-y-1">
                    <p>{warning}</p>
                    <p>
                      موجودی از {fmt(target.stored)} به {fmt(next)} {unitOf(target.currency)} تغییر می‌کند. اگر
                      عدد درست است، دوباره تأیید کنید.
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>توضیح (اختیاری)</Label>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="مثلاً: مطابق صورتحساب بانک"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setTarget(null)}>انصراف</Button>
            <Button onClick={handleFix} disabled={saving}>
              {saving ? 'در حال ثبت...' : warning && confirming ? 'بله، عدد درست است؛ ثبت شود' : 'ثبت اصلاح'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!checkRow} onOpenChange={(o) => !o && setCheckRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ثبت موجودی بانک «{checkRow?.name}»</DialogTitle>
          </DialogHeader>
          {checkRow && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                رقم صورتحساب بانک کنار موجودی فعلی سیستم نگه داشته می‌شود. هیچ موجودی و تراکنشی تغییر نمی‌کند.
              </p>
              <div className="space-y-2">
                <Label>موجودی بانک ({unitOf(checkRow.currency)})</Label>
                <Input
                  type="number"
                  value={bankFigure}
                  onChange={(e) => setBankFigure(e.target.value)}
                  placeholder="رقم صورتحساب بانک"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 text-center text-sm">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">موجودی فعلی سیستم</div>
                  <div className="font-bold">{fmt(checkRow.stored)}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">اختلاف (سیستم − بانک)</div>
                  <div className="font-bold">{bank === null ? '—' : signed(checkRow.stored - bank)}</div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>توضیح (اختیاری)</Label>
                <Input
                  value={checkNote}
                  onChange={(e) => setCheckNote(e.target.value)}
                  placeholder="مثلاً: صورتحساب ۳۱ شهریور"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCheckRow(null)}>انصراف</Button>
            <Button onClick={handleCheck} disabled={saving}>
              {saving ? 'در حال ثبت...' : 'ثبت موجودی بانک'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!baselineRow} onOpenChange={(o) => !o && setBaselineRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ثبت مانده پایه «{baselineRow?.name}»</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  اختلاف این حساب {baselineRow ? fmt(baselineRow.difference) : ''} است. این اختلاف مال گذشته
                  است: موجودی اولیه، ویرایش‌های قدیمی موجودی و ردیف‌های قدیمی.
                </p>
                <p>
                  با این کار یک سند تعدیل به همین مبلغ ثبت می‌شود تا ستون «اختلاف» از صفر شروع شود.{' '}
                  <strong>موجودی حساب تغییر نمی‌کند و پولی جابه‌جا نمی‌شود.</strong>
                </p>
                <p>
                  از این به بعد هر اختلافی که پیدا شود تازه است و باید بررسی شود. اگر ردیف اشتباه قدیمی سراغ
                  دارید، اول آن را اصلاح کنید.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction onClick={handleBaseline} disabled={saving}>
              ثبت مانده پایه
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
