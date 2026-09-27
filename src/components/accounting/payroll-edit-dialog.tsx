'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { updatePayroll } from '@/actions/payroll';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface EditablePayroll {
  id: string;
  employee: { name: string };
  amount: number;
  bonuses: number;
  deductions: number;
  paidAmount: number;
  description?: string;
}

const fmt = (value: number) => new Intl.NumberFormat('fa-IR').format(Math.round(value));

/** An admin corrects a payslip: base pay, bonus or commission, deductions. No money moves. */
export function PayrollEditDialog({
  payroll,
  title,
  open,
  onOpenChange,
  onSaved,
}: {
  payroll: EditablePayroll;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(String(payroll.amount));
  const [bonuses, setBonuses] = useState(String(payroll.bonuses || 0));
  const [deductions, setDeductions] = useState(String(payroll.deductions || 0));
  const [description, setDescription] = useState(payroll.description ?? '');
  const [saving, startSaving] = useTransition();

  const net = (Number(amount) || 0) + (Number(bonuses) || 0) - (Number(deductions) || 0);
  const belowPaid = net < payroll.paidAmount - 0.01;

  const save = () =>
    startSaving(async () => {
      const result = await updatePayroll(payroll.id, {
        amount: Number(amount),
        bonuses: Number(bonuses) || 0,
        deductions: Number(deductions) || 0,
        description,
      });
      if (result.success) {
        toast.success(result.message);
        onSaved();
      } else {
        toast.error(result.message || 'خطا در ویرایش فیش حقوقی');
      }
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>ویرایش فیش حقوقی — {title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="edit-payroll-amount">حقوق پایه (تومان)</Label>
            <Input id="edit-payroll-amount" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="edit-payroll-bonuses">پاداش / کمیسیون فروش</Label>
              <Input id="edit-payroll-bonuses" type="number" min="0" value={bonuses} onChange={(e) => setBonuses(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-payroll-deductions">کسورات</Label>
              <Input id="edit-payroll-deductions" type="number" min="0" value={deductions} onChange={(e) => setDeductions(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-payroll-description">توضیحات</Label>
            <Textarea
              id="edit-payroll-description"
              rows={2}
              placeholder="مثلاً: کمیسیون فروش مهر اضافه شد"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="rounded-lg border p-3 text-sm space-y-1 bg-muted/30">
            <div className="flex justify-between font-bold">
              <span>حقوق خالص:</span>
              <span className={belowPaid ? 'text-red-600' : ''}>{fmt(net)} تومان</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>پرداخت‌شده تا امروز:</span>
              <span>{fmt(payroll.paidAmount)} تومان</span>
            </div>
            <div className="flex justify-between">
              <span>باقیمانده بعد از ویرایش:</span>
              <span className="text-orange-600">{fmt(Math.max(0, net - payroll.paidAmount))} تومان</span>
            </div>
            {belowPaid && (
              <p className="text-xs text-red-600">حقوق خالص نمی‌تواند از مبلغی که پرداخت شده کمتر باشد.</p>
            )}
            <p className="text-xs text-muted-foreground">
              ویرایش فیش پولی جابه‌جا نمی‌کند؛ پرداخت‌های قبلی همان می‌مانند و باقیمانده از روی مبلغ تازه حساب می‌شود.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            انصراف
          </Button>
          <Button onClick={save} disabled={saving || belowPaid || !(net > 0)}>
            {saving ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
