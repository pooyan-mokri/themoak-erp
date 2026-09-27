'use client';

import { useState, useEffect, useMemo } from 'react';
import { Pencil, Plus, Wallet, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PayrollPaymentForm } from './payroll-payment-form';
import { PayrollEditDialog } from './payroll-edit-dialog';
import { cn } from '@/lib/utils';
import { currentPeriod, payrollStatus, periodKey, periodLabel, runStatus } from './payroll-periods';

export interface Payroll {
  id: string;
  employee: {
    id: string;
    name: string;
  };
  amount: number;
  bonuses: number;
  deductions: number;
  netAmount: number;
  paidAmount: number;
  periodMonth: number;
  periodYear: number;
  status: string;
  description?: string;
  payments: any[];
}

interface PayrollListProps {
  payrolls: Payroll[];
  accounts: any[];
  /** Admins may correct a recorded payslip. */
  isAdmin?: boolean;
  /** May pay a payslip (payroll.manage). */
  canManage?: boolean;
  /** How many employees there are, for «N of M» in the current month. */
  employeeCount?: number;
  /** Opens the new-payslip form. */
  onNew?: () => void;
  /** Called after a payment or an edit, to load the payslips again. */
  onChanged?: () => void;
}

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Math.round(n));
const sum = (list: Payroll[], pick: (p: Payroll) => number) => list.reduce((total, p) => total + (pick(p) || 0), 0);
const gross = (p: Payroll) => p.amount + (p.bonuses || 0);
const remainingAmount = (payroll: Payroll) => payroll.netAmount - payroll.paidAmount;

const VIEWS = [
  { id: 'all', label: 'همه', match: () => true },
  { id: 'open', label: 'پرداخت‌نشده', match: (p: Payroll) => p.status !== 'PAID' },
  { id: 'paid', label: 'پرداخت شده', match: (p: Payroll) => p.status === 'PAID' },
] as const;

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-[19px] font-medium tabular-nums">
        {value}
        {value !== '—' && <small className="ms-1 text-[11px] font-normal text-muted-foreground">تومان</small>}
      </p>
      {note && <p className="mt-0.5 text-[11.5px] text-muted-foreground">{note}</p>}
    </div>
  );
}

export function PayrollList({
  payrolls: initialPayrolls,
  accounts,
  isAdmin = false,
  canManage = false,
  employeeCount,
  onNew,
  onChanged,
}: PayrollListProps) {
  const [payrolls, setPayrolls] = useState(initialPayrolls);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedPayroll, setSelectedPayroll] = useState<Payroll | undefined>(undefined);
  const [editing, setEditing] = useState<Payroll | undefined>(undefined);
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('all');
  const [period, setPeriod] = useState<string | null>(null);

  // Update payrolls when initialPayrolls prop changes
  useEffect(() => {
    setPayrolls(initialPayrolls);
  }, [initialPayrolls]);

  const handlePayment = (payroll: Payroll) => {
    setSelectedPayroll(payroll);
    setPaymentDialogOpen(true);
  };

  const refresh = () => {
    if (onChanged) onChanged();
    else window.location.reload();
  };

  const handlePaymentSuccess = () => {
    setPaymentDialogOpen(false);
    setSelectedPayroll(undefined);
    refresh();
  };

  // Every month that has payslips, newest first, with its totals.
  const runs = useMemo(() => {
    const byPeriod = new Map<string, { year: number; month: number; slips: Payroll[] }>();
    for (const p of payrolls) {
      const key = periodKey(p.periodYear, p.periodMonth);
      if (!byPeriod.has(key)) byPeriod.set(key, { year: p.periodYear, month: p.periodMonth, slips: [] });
      byPeriod.get(key)!.slips.push(p);
    }
    return Array.from(byPeriod.entries())
      .map(([key, run]) => ({ key, ...run }))
      .sort((a, b) => b.year - a.year || b.month - a.month);
  }, [payrolls]);

  const now = currentPeriod();
  const current = payrolls.filter((p) => p.periodYear === now.year && p.periodMonth === now.month);
  const currentStatus = runStatus(current);

  const periodRun = period ? runs.find((r) => r.key === period) : undefined;
  const currentView = VIEWS.find((v) => v.id === view) ?? VIEWS[0];
  const rows = payrolls.filter(
    (p) => currentView.match(p) && (!period || periodKey(p.periodYear, p.periodMonth) === period),
  );

  return (
    <>
      {/* The current Jalali month, from its payslips */}
      <div className="grid gap-5 rounded-lg border bg-card p-5 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div>
          <p className="text-xs text-muted-foreground">دوره فعلی</p>
          <h2 className="mt-1 text-[22px] font-semibold leading-tight">{periodLabel(now.year, now.month)}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {current.length > 0 ? (
              <>
                <span className={cn('rounded-full px-2 py-0.5 text-[11.5px]', currentStatus.tone)}>{currentStatus.label}</span>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[11.5px] text-muted-foreground">
                  {fa(current.length)} فیش
                  {employeeCount !== undefined && ` از ${fa(employeeCount)} کارمند`}
                </span>
              </>
            ) : (
              <span className="text-[12.5px] text-muted-foreground">برای این ماه هنوز فیش حقوقی ثبت نشده است.</span>
            )}
          </div>
          {current.length === 0 && onNew && (
            <Button size="sm" className="mt-3" onClick={onNew}>
              <Plus className="h-4 w-4" />
              فیش حقوقی این ماه
            </Button>
          )}
        </div>
        <Figure
          label="جمع ناخالص"
          value={current.length ? fa(sum(current, gross)) : '—'}
          note={current.length ? 'حقوق پایه + پاداش' : undefined}
        />
        <Figure
          label="جمع خالص"
          value={current.length ? fa(sum(current, (p) => p.netAmount)) : '—'}
          note={current.length ? `پس از ${fa(sum(current, (p) => p.deductions))} کسورات` : undefined}
        />
        <Figure
          label="مانده پرداخت"
          value={current.length ? fa(sum(current, remainingAmount)) : '—'}
          note={current.length ? `پرداخت‌شده: ${fa(sum(current, (p) => p.paidAmount))}` : undefined}
        />
      </div>

      {/* Run history: one card per month */}
      {runs.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">دوره‌های اخیر</h3>
            {period && (
              <button type="button" onClick={() => setPeriod(null)} className="text-xs text-brand hover:underline">
                همه دوره‌ها
              </button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {runs.slice(0, 6).map((run) => {
              const status = runStatus(run.slips);
              const paid = sum(run.slips, (p) => p.paidAmount);
              return (
                <button
                  key={run.key}
                  type="button"
                  onClick={() => setPeriod((p) => (p === run.key ? null : run.key))}
                  className={cn(
                    'rounded-lg border bg-card p-4 text-start transition-colors duration-150 hover:border-input',
                    period === run.key && 'border-brand bg-brand-soft/40',
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium">{periodLabel(run.year, run.month)}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[11.5px]', status.tone)}>{status.label}</span>
                  </div>
                  <p className="mt-2 text-[19px] font-medium tabular-nums">
                    {fa(sum(run.slips, (p) => p.netAmount))}
                    <small className="ms-1 text-[11px] font-normal text-muted-foreground">تومان خالص</small>
                  </p>
                  <p className="mt-1 text-[11.5px] text-muted-foreground">
                    {fa(run.slips.length)} کارمند · پرداخت‌شده {fa(paid)}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Payslips */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="me-2 text-sm font-medium">
            فیش‌های حقوقی
            {periodRun && <span className="text-muted-foreground"> · {periodLabel(periodRun.year, periodRun.month)}</span>}
          </h3>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors duration-150',
                view === v.id ? 'border-foreground bg-foreground text-white' : 'bg-card hover:border-foreground/40',
              )}
            >
              {v.label}
              <span className="font-mono text-[11px] opacity-70">
                {fa(payrolls.filter((p) => v.match(p) && (!period || periodKey(p.periodYear, p.periodMonth) === period)).length)}
              </span>
            </button>
          ))}
          {period && (
            <Button variant="ghost" size="sm" onClick={() => setPeriod(null)}>
              <X className="h-4 w-4" />
              همه دوره‌ها
            </Button>
          )}
          <span className="ms-auto text-xs text-muted-foreground">مبلغ‌ها به تومان</span>
        </div>

        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-b bg-secondary text-xs text-muted-foreground">
                  <th className="h-9 px-3 text-start font-normal">کارمند</th>
                  <th className="h-9 px-3 text-start font-normal">دوره</th>
                  <th className="h-9 px-3 text-end font-normal">حقوق پایه</th>
                  <th className="h-9 px-3 text-end font-normal">پاداش</th>
                  <th className="h-9 px-3 text-end font-normal">کسورات</th>
                  <th className="h-9 px-3 text-end font-normal">خالص</th>
                  <th className="h-9 px-3 text-end font-normal">پرداخت شده</th>
                  <th className="h-9 px-3 text-end font-normal">باقیمانده</th>
                  <th className="h-9 px-3 text-start font-normal">وضعیت</th>
                  {(canManage || isAdmin) && <th className="h-9 px-3" />}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="h-24 text-center text-[13px] text-muted-foreground">
                      {payrolls.length === 0
                        ? `هیچ فیش حقوقی ثبت نشده است.${onNew ? ' با «فیش حقوقی جدید» اولین فیش را بزنید.' : ''}`
                        : 'فیشی با این نما پیدا نشد.'}
                    </td>
                  </tr>
                ) : (
                  rows.map((payroll) => {
                    const status = payrollStatus(payroll.status);
                    const remaining = remainingAmount(payroll);
                    return (
                      <tr key={payroll.id} className="h-11 border-b transition-colors duration-150 last:border-0 hover:bg-brand/[.04]">
                        <td className="px-3 font-medium">{payroll.employee.name}</td>
                        <td className="whitespace-nowrap px-3 text-muted-foreground">{periodLabel(payroll.periodYear, payroll.periodMonth)}</td>
                        <td className="px-3 text-end tabular-nums">{fa(payroll.amount)}</td>
                        <td className="px-3 text-end tabular-nums">{payroll.bonuses ? fa(payroll.bonuses) : '—'}</td>
                        <td className="px-3 text-end tabular-nums">{payroll.deductions ? fa(payroll.deductions) : '—'}</td>
                        <td className="px-3 text-end font-medium tabular-nums">{fa(payroll.netAmount)}</td>
                        <td className="px-3 text-end tabular-nums text-muted-foreground">{payroll.paidAmount ? fa(payroll.paidAmount) : '—'}</td>
                        <td className="px-3 text-end tabular-nums">{remaining > 0 ? fa(remaining) : '—'}</td>
                        <td className="px-3">
                          <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px]', status.tone)}>{status.label}</span>
                        </td>
                        {(canManage || isAdmin) && (
                          <td className="px-3">
                            <div className="flex justify-end gap-1">
                              {canManage && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handlePayment(payroll)}
                                  disabled={payroll.status === 'PAID' || remaining <= 0}
                                >
                                  <Wallet className="h-4 w-4" />
                                  پرداخت
                                </Button>
                              )}
                              {isAdmin && (
                                <Button variant="ghost" size="sm" onClick={() => setEditing(payroll)} title="ویرایش فیش حقوقی">
                                  <Pencil className="h-4 w-4" />
                                  ویرایش
                                </Button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {editing && (
        <PayrollEditDialog
          key={editing.id}
          payroll={editing}
          title={`${editing.employee.name} - ${periodLabel(editing.periodYear, editing.periodMonth)}`}
          open
          onOpenChange={(open) => !open && setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            refresh();
          }}
        />
      )}

      {selectedPayroll && (
        <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>
                ثبت پرداخت حقوق — {selectedPayroll.employee.name} · {periodLabel(selectedPayroll.periodYear, selectedPayroll.periodMonth)}
              </DialogTitle>
            </DialogHeader>
            <PayrollPaymentForm payroll={selectedPayroll} accounts={accounts} onSuccess={handlePaymentSuccess} />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
