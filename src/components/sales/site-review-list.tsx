'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useRequestId } from '@/components/ui/request-id';
import { accountLabel } from '@/lib/account-label';
import { formatJalaliDateTime } from '@/lib/date-utils';
import {
  markSiteOrderKept,
  recordSiteOrderReceipt,
  recordSiteOrderRefund,
  type SiteReviewAction,
  type SiteReviewRow,
} from '@/actions/site-review';

type AccountOption = { id: string; name: string; type: string; currency: string; cardNumber?: string | null };

const TITLES: Record<SiteReviewAction, string> = {
  refund: 'ثبت بازپرداخت',
  kept: 'بدون بازپرداخت؛ پول می‌ماند',
  receipt: 'پول رسیده است؛ ثبت دریافت',
};

const toman = (n: number) => `${Math.round(n).toLocaleString('fa-IR')} تومان`;

export function SiteReviewList({
  rows,
  accounts,
  isAdmin,
}: {
  rows: SiteReviewRow[];
  /** Money accounts for the refund and receipt pickers (ADMIN only). */
  accounts: AccountOption[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [requestId, renewRequestId] = useRequestId();
  const [target, setTarget] = useState<{ row: SiteReviewRow; action: SiteReviewAction } | null>(null);
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  // A refund or receipt moves real money: only accounts that hold it.
  const moneyAccounts = accounts.filter((account) => account.type !== 'EXPENSE');
  const canSeeAmounts = rows.some((row) => row.amounts !== null);

  const open = (row: SiteReviewRow, action: SiteReviewAction) => {
    setTarget({ row, action });
    setAmount(
      action === 'refund' && row.amounts ? String(row.amounts.held) : action === 'receipt' && row.amounts ? String(row.amounts.owed) : '',
    );
    setAccountId(action === 'refund' ? row.saleAccountId ?? '' : '');
    setNote('');
  };

  const submit = async () => {
    if (!target) return;
    const { row, action } = target;
    setSaving(true);
    const result =
      action === 'kept'
        ? await markSiteOrderKept({ orderId: row.id, note })
        : await (action === 'refund' ? recordSiteOrderRefund : recordSiteOrderReceipt)({
            orderId: row.id,
            accountId,
            amount: Number(amount),
            note,
            requestId,
          });
    setSaving(false);
    if (result.success) {
      toast.success(result.message ?? 'ثبت شد.');
      renewRequestId();
      setTarget(null);
      router.refresh();
    } else {
      toast.error(result.message ?? 'خطا در ثبت.');
    }
  };

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          سفارش سایتی نیست که پولش منتظر تصمیم باشد.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardContent className="pt-6">
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">سفارش</TableHead>
                  <TableHead className="text-right">مشتری</TableHead>
                  <TableHead className="text-right">چرا اینجاست</TableHead>
                  {canSeeAmounts && (
                    <>
                      <TableHead className="text-right">پرداخت طبق سایت</TableHead>
                      <TableHead className="text-right">بازپرداخت در سایت</TableHead>
                      <TableHead className="text-right">نزد ERP</TableHead>
                      <TableHead className="text-right">مانده بدهی</TableHead>
                    </>
                  )}
                  {isAdmin && <TableHead className="text-right">تصمیم</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">
                      <Link href={`/dashboard/sales/history/${row.id}`} className="text-blue-600 hover:underline">
                        #{row.number}
                      </Link>
                      <div dir="ltr" className="font-mono text-xs text-muted-foreground">{row.reference}</div>
                      {row.issuedAt && (
                        <div className="text-xs text-muted-foreground">{formatJalaliDateTime(row.issuedAt)}</div>
                      )}
                      {row.cancelled && <Badge variant="destructive" className="mt-1">لغو شده</Badge>}
                    </TableCell>
                    <TableCell>{row.customerName ?? '—'}</TableCell>
                    <TableCell className="max-w-md space-y-1 text-sm">
                      {row.reasons.map((reason, i) => (
                        <div key={i}>{reason}</div>
                      ))}
                      {(row.gateway || row.trackId) && (
                        <div className="text-xs text-muted-foreground">
                          درگاه: {row.gateway ?? '—'} · trackId: <span dir="ltr">{row.trackId ?? '—'}</span>
                        </div>
                      )}
                      {row.decisions.map((d, i) => (
                        <div key={`d${i}`} className="text-xs text-muted-foreground">
                          پیش‌تر: {d.status}
                          {d.amount != null ? ` · ${toman(d.amount)}` : ''} · {formatJalaliDateTime(d.at)}
                          {d.note ? ` — ${d.note}` : ''}
                        </div>
                      ))}
                    </TableCell>
                    {canSeeAmounts && (
                      <>
                        <TableCell className="whitespace-nowrap">{row.amounts ? toman(row.amounts.sitePaid) : '—'}</TableCell>
                        <TableCell className="whitespace-nowrap">{row.amounts ? toman(row.amounts.siteRefunded) : '—'}</TableCell>
                        <TableCell className="whitespace-nowrap font-semibold">
                          {row.amounts ? toman(row.amounts.held) : '—'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{row.amounts ? toman(row.amounts.owed) : '—'}</TableCell>
                      </>
                    )}
                    {isAdmin && (
                      <TableCell>
                        <div className="flex flex-col gap-2">
                          {row.actions.map((action) => (
                            <Button key={action} variant="outline" size="sm" onClick={() => open(row, action)}>
                              {TITLES[action]}
                            </Button>
                          ))}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!target} onOpenChange={(value) => !value && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {target ? `${TITLES[target.action]} — سفارش #${target.row.number}` : ''}
            </DialogTitle>
          </DialogHeader>
          {target && (
            <div className="space-y-4">
              {target.action === 'refund' && !target.row.cancelled && (
                <p className="rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-800">
                  این سفارش در سایت لغو نشده است. مبلغ از حساب کم می‌شود و سفارش دوباره پرداخت‌نشده می‌شود. اگر پول را به
                  مشتری برگردانده‌اید، بازپرداخت را در پنل سایت ثبت کنید، نه اینجا؛ ثبت در هر دو جا آن را دو بار کم می‌کند.
                </p>
              )}
              {target.action === 'kept' && (
                <p className="text-sm text-muted-foreground">
                  پولی جابه‌جا نمی‌شود؛ فقط ثبت می‌شود که پول این سفارش واقعاً رسیده و برگردانده نمی‌شود.
                </p>
              )}
              {target.action !== 'kept' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="site-review-amount">مبلغ (تومان)</Label>
                    <Input
                      id="site-review-amount"
                      type="number"
                      min="0"
                      step="any"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{target.action === 'refund' ? 'از حساب' : 'به حساب'}</Label>
                    <Select value={accountId} onValueChange={setAccountId}>
                      <SelectTrigger>
                        <SelectValue placeholder="انتخاب حساب" />
                      </SelectTrigger>
                      <SelectContent>
                        {moneyAccounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {accountLabel(account)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      حسابی که پول واقعاً {target.action === 'refund' ? 'از آن رفت' : 'به آن آمد'}؛ نه لزوماً حساب فروش.
                    </p>
                  </div>
                </>
              )}
              <div className="space-y-2">
                <Label htmlFor="site-review-note">توضیح *</Label>
                <Textarea
                  id="site-review-note"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={target.action === 'kept' ? 'مثلاً: پول در زیبال تسویه شد و مشتری کالا را نگه داشت' : 'مثلاً: کارت‌به‌کارت به مشتری، ۱۴۰۵/۰۶/۳۰'}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              انصراف
            </Button>
            <Button onClick={submit} disabled={saving || !note.trim()}>
              {saving ? 'در حال ثبت...' : 'ثبت'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
