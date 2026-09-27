'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { HandCoins, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { cn } from '@/lib/utils';
import { formatJalaliDate } from '@/lib/date-utils';
import { LoanForm } from './loan-form';
import { LoanPaymentForm } from './loan-payment-form';
import { fa } from './finance-bits';

interface Loan {
  id: string;
  employee: {
    id: string;
    name: string;
  };
  amount: number;
  remaining: number;
  interestRate: number;
  description?: string;
  dueDate?: Date;
  status: string;
  createdAt?: Date;
  payments: any[];
}

interface LoanListProps {
  loans: Loan[];
  accounts: any[];
  /** For the new-loan form. */
  employees?: Array<{ id: string; name: string }>;
  /** May lend and record repayments (payroll.manage). */
  canManage?: boolean;
}

const isOpen = (loan: Loan) => loan.status !== 'PAID' && loan.remaining > 0;
const paidOf = (loan: Loan) => loan.amount - loan.remaining;

/** Status is a colour and a word: settled, past its due date, open, or written off. */
function statusOf(loan: Loan, now: number): { label: string; tone: string } {
  if (loan.status === 'PAID' || loan.remaining <= 0) return { label: 'تسویه', tone: 'bg-success-soft text-success' };
  if (loan.status === 'DEFAULTED') return { label: 'معوق', tone: 'bg-danger-soft text-danger' };
  if (loan.dueDate && new Date(loan.dueDate).getTime() < now) return { label: 'سررسید گذشته', tone: 'bg-warning-soft text-warning' };
  return { label: 'در حال بازپرداخت', tone: 'bg-brand-soft text-brand' };
}

const VIEWS = [
  { id: 'all', label: 'همه', match: () => true },
  { id: 'open', label: 'باز', match: (l: Loan) => isOpen(l) },
  { id: 'due', label: 'سررسید گذشته', match: (l: Loan, now: number) => isOpen(l) && !!l.dueDate && new Date(l.dueDate).getTime() < now },
  { id: 'paid', label: 'تسویه‌شده', match: (l: Loan) => !isOpen(l) },
] as const;

export function LoanList({ loans, accounts, employees = [], canManage = false }: LoanListProps) {
  const router = useRouter();
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState<Loan | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('all');
  const [peekId, setPeekId] = useState<string | null>(null);

  const handlePayment = (loan: Loan) => {
    setSelectedLoan(loan);
    setPaymentDialogOpen(true);
  };

  const handlePaymentSuccess = () => {
    setPaymentDialogOpen(false);
    setSelectedLoan(undefined);
    router.refresh();
  };

  const now = Date.now();
  const open = loans.filter(isOpen);
  const overdue = open.filter((l) => l.dueDate && new Date(l.dueDate).getTime() < now);
  const lent = loans.reduce((sum, l) => sum + l.amount, 0);
  const repaid = loans.reduce((sum, l) => sum + paidOf(l), 0);
  const outstanding = open.reduce((sum, l) => sum + l.remaining, 0);
  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[0];
  const rows = loans.filter((l) => current.match(l, now));
  const peek = peekId ? loans.find((l) => l.id === peekId) ?? null : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="قرض‌های کارمندان"
        description={`${fa(loans.length)} قرض · ${fa(open.length)} باز`}
        actions={
          canManage && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              قرض جدید
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="قرض‌های باز" value={fa(open.length)} note={`از ${fa(loans.length)} قرض`} />
        <KpiCard
          label="مانده کل"
          value={outstanding ? fa(outstanding) : '—'}
          unit={outstanding ? 'تومان' : undefined}
          note={`${fa(new Set(open.map((l) => l.employee.id)).size)} کارمند بدهکار`}
        />
        <KpiCard
          label="بازپرداخت‌شده"
          value={repaid ? fa(repaid) : '—'}
          unit={repaid ? 'تومان' : undefined}
          note={lent ? `${fa((repaid / lent) * 100)}٪ از ${fa(lent)} تومان` : 'هنوز قرضی داده نشده'}
        />
        <KpiCard
          label="سررسید گذشته"
          value={fa(overdue.length)}
          note={overdue.length ? `${fa(overdue.reduce((sum, l) => sum + l.remaining, 0))} تومان مانده` : 'قرض سررسیدگذشته‌ای نیست'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
            <span className="font-mono text-[11px] opacity-70">{fa(loans.filter((l) => v.match(l, now)).length)}</span>
          </button>
        ))}
      </div>

      <div className={cn('grid gap-4', peek && 'lg:grid-cols-[1fr_340px]')}>
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-b">
                  <th className="h-9 bg-secondary px-4 text-start text-xs font-normal text-muted-foreground">کارمند</th>
                  <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">مبلغ قرض (تومان)</th>
                  <th className="h-9 w-[180px] bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">بازپرداخت</th>
                  <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">مانده</th>
                  {!peek && <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">نرخ بهره</th>}
                  {!peek && <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">سررسید</th>}
                  <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">وضعیت</th>
                  {canManage && !peek && <th className="h-9 bg-secondary px-3" />}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="h-24 px-4 text-center text-[13px] text-muted-foreground">
                      {loans.length === 0
                        ? `هنوز قرضی ثبت نشده است.${canManage ? ' با «قرض جدید» مبلغ، کارمند و حساب پرداخت‌کننده را ثبت کنید.' : ''}`
                        : 'قرضی در این نما نیست.'}
                    </td>
                  </tr>
                )}
                {rows.map((loan) => {
                  const status = statusOf(loan, now);
                  const share = loan.amount > 0 ? (paidOf(loan) / loan.amount) * 100 : 0;
                  return (
                    <tr
                      key={loan.id}
                      onClick={() => setPeekId((id) => (id === loan.id ? null : loan.id))}
                      className={cn(
                        'h-11 cursor-pointer border-b transition-colors duration-150 last:border-0 hover:bg-brand/[.04]',
                        peekId === loan.id && 'bg-brand-soft',
                      )}
                    >
                      <td className="px-4 font-medium">{loan.employee.name}</td>
                      <td className="px-3 text-end tabular-nums">{fa(loan.amount)}</td>
                      <td className="px-3">
                        <div className="h-1.5 overflow-hidden rounded bg-secondary">
                          <span className="block h-full bg-brand" style={{ width: `${Math.min(100, share)}%` }} />
                        </div>
                        <div className="mt-1 text-[11.5px] text-muted-foreground">
                          {fa(share)}٪ · {fa(loan.payments.length)} پرداخت
                        </div>
                      </td>
                      <td className="px-3 text-end font-medium tabular-nums">{isOpen(loan) ? fa(loan.remaining) : '—'}</td>
                      {!peek && (
                        <td className="px-3 text-end tabular-nums text-muted-foreground">
                          {loan.interestRate > 0 ? `${fa(loan.interestRate, 2)}٪` : '—'}
                        </td>
                      )}
                      {!peek && (
                        <td className="whitespace-nowrap px-3 tabular-nums text-muted-foreground">
                          {loan.dueDate ? formatJalaliDate(loan.dueDate) : '—'}
                        </td>
                      )}
                      <td className="px-3">
                        <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px]', status.tone)}>{status.label}</span>
                      </td>
                      {canManage && !peek && (
                        <td className="px-3 text-end" onClick={(e) => e.stopPropagation()}>
                          {isOpen(loan) && (
                            <Button variant="outline" size="sm" onClick={() => handlePayment(loan)}>
                              <HandCoins className="h-4 w-4" />
                              بازپرداخت
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {peek && (
          <aside className="h-fit space-y-3 rounded-lg border bg-card p-4 lg:sticky lg:top-20">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[15px] font-medium">{peek.employee.name}</p>
                <p className="text-[12.5px] text-muted-foreground">
                  قرض {fa(peek.amount)} تومان
                  {peek.createdAt && ` · ${formatJalaliDate(peek.createdAt)}`}
                </p>
              </div>
              <button onClick={() => setPeekId(null)} className="rounded p-1 text-muted-foreground hover:bg-secondary" title="بستن">
                <X className="h-4 w-4" />
              </button>
            </div>
            <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11.5px]', statusOf(peek, now).tone)}>
              {statusOf(peek, now).label}
            </span>
            <dl className="space-y-1 text-[12.5px]">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">بازپرداخت‌شده</dt>
                <dd className="tabular-nums">{fa(paidOf(peek))}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">مانده</dt>
                <dd className="font-medium tabular-nums">{fa(Math.max(0, peek.remaining))} تومان</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">نرخ بهره سالانه</dt>
                <dd className="tabular-nums">{peek.interestRate > 0 ? `${fa(peek.interestRate, 2)}٪` : '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">سررسید</dt>
                <dd className="tabular-nums">{peek.dueDate ? formatJalaliDate(peek.dueDate) : '—'}</dd>
              </div>
            </dl>
            {peek.description && <p className="text-[12.5px] text-muted-foreground">{peek.description}</p>}
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">بازپرداخت‌ها</p>
              {peek.payments.length === 0 ? (
                <p className="text-[12.5px] text-muted-foreground">هنوز بازپرداختی ثبت نشده است.</p>
              ) : (
                <div className="divide-y rounded-md border">
                  {peek.payments.map((payment: any) => (
                    <div key={payment.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[12.5px]">
                      <span className="tabular-nums text-muted-foreground">{formatJalaliDate(payment.date)}</span>
                      <span className="tabular-nums">{fa(payment.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {canManage && isOpen(peek) && (
              <Button size="sm" onClick={() => handlePayment(peek)}>
                <HandCoins className="h-4 w-4" />
                ثبت بازپرداخت
              </Button>
            )}
          </aside>
        )}
      </div>

      {selectedLoan && (
        <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                ثبت بازپرداخت - {selectedLoan.employee.name}
              </DialogTitle>
            </DialogHeader>
            <LoanPaymentForm
              loan={selectedLoan}
              accounts={accounts}
              onSuccess={handlePaymentSuccess}
            />
          </DialogContent>
        </Dialog>
      )}

      {canManage && (
        <Dialog open={adding} onOpenChange={setAdding}>
          <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>ثبت قرض جدید</DialogTitle>
            </DialogHeader>
            {adding && (
              <LoanForm
                bare
                employees={employees}
                accounts={accounts}
                onSuccess={() => {
                  setAdding(false);
                  router.refresh();
                }}
              />
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
