'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { HandCoins, X } from 'lucide-react';
import { getEmployeeDebtDetails } from '@/actions/accounting';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { cn } from '@/lib/utils';
import { formatJalaliDate } from '@/lib/date-utils';
import { PayDebtDialog } from './pay-debt-dialog';
import { fa } from './finance-bits';

interface Employee {
  id: string;
  name: string;
  phone?: string;
  email?: string;
}

interface Debt {
  employee: Employee;
  totalDebt: number;
  expenseCount: number;
  paymentCount: number;
}

interface Account {
  id: string;
  name: string;
  currency: string;
}

type Details = NonNullable<Awaited<ReturnType<typeof getEmployeeDebtDetails>>>;

interface EmployeeDebtListProps {
  debts: Debt[];
  accounts: Account[];
  /** May pay a debt back (payroll.manage). */
  canManage?: boolean;
  /** What employees still owe on their loans (the loans page), for the net figure. */
  loans?: { outstanding: number; count: number };
}

/**
 * What the company owes its employees for expenses they paid themselves, with
 * each employee's expenses and repayments in a side panel.
 */
export function EmployeeDebtList({ debts, accounts, canManage = false, loans }: EmployeeDebtListProps) {
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | undefined>(undefined);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [loading, setLoading] = useState(false);

  const handlePayDebt = (employee: Employee) => {
    setSelectedEmployee(employee);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setSelectedEmployee(undefined);
  };

  // The itemised rows of the employee in the side panel, read again after a repayment.
  useEffect(() => {
    if (!peekId) {
      setDetails(null);
      return;
    }
    let live = true;
    setLoading(true);
    getEmployeeDebtDetails(peekId)
      .then((result) => live && setDetails(result ?? null))
      .catch(() => live && setDetails(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [peekId, debts]);

  const owed = debts.reduce((sum, d) => sum + d.totalDebt, 0);
  const lent = loans?.outstanding ?? 0;
  const net = owed - lent;
  const peek = peekId ? debts.find((d) => d.employee.id === peekId) ?? null : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="بدهی کارمندان"
        description="هزینه‌هایی که کارمندان از جیب خود پرداخته‌اند و شرکت باید به آن‌ها برگرداند"
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="شرکت به کارمندان بدهکار است"
          value={owed ? fa(owed) : '—'}
          unit={owed ? 'تومان' : undefined}
          note={`${fa(debts.length)} کارمند`}
        />
        {loans && (
          <KpiCard
            label="کارمندان به شرکت بدهکارند"
            value={lent ? fa(lent) : '—'}
            unit={lent ? 'تومان' : undefined}
            note={
              <Link href="/dashboard/accounting/loans" className="text-brand hover:underline">
                مانده {fa(loans.count)} قرض باز
              </Link>
            }
          />
        )}
        {loans && (
          <KpiCard
            label="خالص"
            value={net ? fa(Math.abs(net)) : '—'}
            unit={net ? 'تومان' : undefined}
            note={net > 0 ? 'شرکت بدهکار است' : net < 0 ? 'کارمندان بدهکارند' : 'تراز'}
          />
        )}
      </div>

      <div className={cn('grid gap-4', peek && 'lg:grid-cols-[1fr_380px]')}>
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-b">
                  <th className="h-9 bg-secondary px-4 text-start text-xs font-normal text-muted-foreground">کارمند</th>
                  {!peek && <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">تلفن</th>}
                  <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">هزینه‌ها</th>
                  <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">بازپرداخت‌ها</th>
                  <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">بدهی (تومان)</th>
                  {canManage && !peek && <th className="h-9 bg-secondary px-3" />}
                </tr>
              </thead>
              <tbody>
                {debts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="h-24 px-4 text-center text-[13px] text-muted-foreground">
                      بدهی بازی به کارمندان نیست. هزینه‌ای که کارمند از جیب خود بدهد، در فرم هزینه با انتخاب کارمند ثبت می‌شود و اینجا
                      می‌آید.
                    </td>
                  </tr>
                )}
                {debts.map((debt) => (
                  <tr
                    key={debt.employee.id}
                    onClick={() => setPeekId((id) => (id === debt.employee.id ? null : debt.employee.id))}
                    className={cn(
                      'h-11 cursor-pointer border-b transition-colors duration-150 last:border-0 hover:bg-brand/[.04]',
                      peekId === debt.employee.id && 'bg-brand-soft',
                    )}
                  >
                    <td className="px-4 font-medium">{debt.employee.name}</td>
                    {!peek && <td className="px-3 tabular-nums text-muted-foreground">{debt.employee.phone || '—'}</td>}
                    <td className="px-3 text-end tabular-nums text-muted-foreground">{fa(debt.expenseCount)}</td>
                    <td className="px-3 text-end tabular-nums text-muted-foreground">{fa(debt.paymentCount)}</td>
                    <td className="px-3 text-end font-medium tabular-nums">{fa(debt.totalDebt)}</td>
                    {canManage && !peek && (
                      <td className="px-3 text-end" onClick={(e) => e.stopPropagation()}>
                        <Button variant="outline" size="sm" onClick={() => handlePayDebt(debt.employee)}>
                          <HandCoins className="h-4 w-4" />
                          بازپرداخت
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
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
                  بدهی {fa(peek.totalDebt)} تومان
                  {peek.employee.phone && ` · ${peek.employee.phone}`}
                </p>
              </div>
              <button onClick={() => setPeekId(null)} className="rounded p-1 text-muted-foreground hover:bg-secondary" title="بستن">
                <X className="h-4 w-4" />
              </button>
            </div>

            {loading && !details ? (
              <p className="py-4 text-[12.5px] text-muted-foreground">در حال خواندن ردیف‌ها…</p>
            ) : details ? (
              <>
                <dl className="space-y-1 text-[12.5px]">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">جمع هزینه‌ها</dt>
                    <dd className="tabular-nums">{fa(details.totalExpenses)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">جمع بازپرداخت‌ها</dt>
                    <dd className="tabular-nums">{fa(details.totalPayments)}</dd>
                  </div>
                  <div className="flex justify-between border-t pt-1">
                    <dt className="text-muted-foreground">مانده</dt>
                    <dd className="font-medium tabular-nums">{fa(details.totalDebt)} تومان</dd>
                  </div>
                </dl>

                <div>
                  <p className="mb-1.5 text-xs text-muted-foreground">هزینه‌ها</p>
                  {details.expenseTransactions.length === 0 ? (
                    <p className="text-[12.5px] text-muted-foreground">هزینه‌ای ثبت نشده است.</p>
                  ) : (
                    <div className="max-h-[260px] divide-y overflow-y-auto rounded-md border">
                      {details.expenseTransactions.map((row: any) => (
                        <div key={row.id} className="grid grid-cols-[1fr_auto] gap-x-2 px-3 py-2 text-[12.5px]">
                          <span className="truncate" title={row.description ?? undefined}>
                            {row.category || row.description || 'هزینه'}
                          </span>
                          <span className="text-end tabular-nums">{fa(row.amount)}</span>
                          <span className="truncate text-[11.5px] text-muted-foreground">
                            {formatJalaliDate(row.date)}
                            {row.project && ` · ${row.project}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <p className="mb-1.5 text-xs text-muted-foreground">بازپرداخت‌ها</p>
                  {details.paymentTransactions.length === 0 ? (
                    <p className="text-[12.5px] text-muted-foreground">هنوز بازپرداختی ثبت نشده است.</p>
                  ) : (
                    <div className="max-h-[200px] divide-y overflow-y-auto rounded-md border">
                      {details.paymentTransactions.map((row: any) => (
                        <div key={row.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[12.5px]">
                          <span className="truncate text-muted-foreground">
                            {formatJalaliDate(row.date)}
                            {row.account && ` · ${row.account}`}
                          </span>
                          <span className="tabular-nums">{fa(row.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="py-4 text-[12.5px] text-muted-foreground">ردیف‌های این کارمند خوانده نشد؛ صفحه را تازه کنید.</p>
            )}

            {canManage && (
              <Button size="sm" onClick={() => handlePayDebt(peek.employee)}>
                <HandCoins className="h-4 w-4" />
                ثبت بازپرداخت
              </Button>
            )}
          </aside>
        )}
      </div>

      {selectedEmployee && (
        <PayDebtDialog
          employee={selectedEmployee}
          accounts={accounts}
          isOpen={isDialogOpen}
          onClose={handleCloseDialog}
        />
      )}
    </div>
  );
}
