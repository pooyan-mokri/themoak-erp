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
import { Wrench, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatJalaliDate } from '@/lib/date-utils';
import { adjustAccountBalance } from '@/actions/accounting';

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
};

export function AccountReconciliation({ rows, isAdmin }: { rows: Row[]; isAdmin: boolean }) {
  const router = useRouter();
  const [target, setTarget] = useState<Row | null>(null);
  const [newBalance, setNewBalance] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const openFix = (row: Row) => {
    setTarget(row);
    setNewBalance(String(Math.round(row.computed)));
    setNote('');
  };

  const handleFix = async () => {
    if (!target) return;
    const value = Number(newBalance);
    if (!Number.isFinite(value)) {
      toast.error('عدد واردشده معتبر نیست.');
      return;
    }
    setSaving(true);
    const result = await adjustAccountBalance({
      accountId: target.id,
      targetBalance: value,
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

  const fmt = (n: number) => Math.round(n).toLocaleString('fa-IR');
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
          <CardTitle className="text-base">مقایسه موجودی ثبت‌شده با دفتر تراکنش‌ها</CardTitle>
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
                  <TableHead className="text-right">تراکنش</TableHead>
                  <TableHead className="text-right">آخرین تراکنش</TableHead>
                  {isAdmin && <TableHead className="text-left">اصلاح</TableHead>}
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
                      <TableCell className="text-muted-foreground">
                        {r.transactionCount.toLocaleString('fa-IR')}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {r.lastTransactionAt ? formatJalaliDate(r.lastTransactionAt) : '—'}
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-left">
                          <Button variant="outline" size="sm" onClick={() => openFix(r)}>
                            <Wrench className="h-4 w-4 ml-1" />
                            اصلاح موجودی
                          </Button>
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
              <div className="grid grid-cols-2 gap-2 text-center text-sm">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">موجودی فعلی سیستم</div>
                  <div className="font-bold">{fmt(target.stored)}</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">جمع تراکنش‌ها</div>
                  <div className="font-bold">{fmt(target.computed)}</div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>موجودی صحیح ({target.currency})</Label>
                <Input
                  type="number"
                  value={newBalance}
                  onChange={(e) => setNewBalance(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  عدد واقعی حساب را وارد کنید (مثلاً از صورتحساب بانک). سند اصلاحی برای تفاوت ثبت می‌شود.
                </p>
              </div>

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
              {saving ? 'در حال ثبت...' : 'ثبت اصلاح'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
