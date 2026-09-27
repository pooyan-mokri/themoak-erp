'use client';

import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { CalendarDays, Pencil, Trash2, Users, Wallet } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { SectionCard } from '@/components/dashboard/section-card';
import { EmployeeForm } from './employee-form';
import { deleteEmployee } from '@/actions/employee';
import { formatJalaliDate, formatJalaliDateShort } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import { tenureLabel, tenureMonths, upcomingAnniversaries } from './employee-tenure';

export interface Employee {
  id: string;
  name: string;
  nationalId?: string;
  phone?: string;
  email?: string;
  address?: string;
  position?: string;
  salary: number;
  hireDate?: Date;
}

interface EmployeeListProps {
  employees: Employee[];
  /** May edit and delete (payroll.manage); the server checks it again. */
  canManage?: boolean;
  /** Called after an edit is saved, to load the list again. */
  onChanged?: () => void;
}

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);

function Initial({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-md bg-brand-soft text-[15px] text-brand', className)}>
      {name.trim().charAt(0) || '؟'}
    </span>
  );
}

export function EmployeeList({ employees: initialEmployees, canManage = false, onChanged }: EmployeeListProps) {
  const [employees, setEmployees] = useState(initialEmployees);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | undefined>(undefined);

  // Update employees when initialEmployees prop changes
  useEffect(() => {
    setEmployees(initialEmployees);
  }, [initialEmployees]);

  const handleEdit = (employee: Employee) => {
    setSelectedEmployee(employee);
    setEditDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    // The server refuses an employee who still has a loan, and says so.
    const result = await deleteEmployee(id);
    if (result.success) {
      toast.success(result.message);
      setEmployees(employees.filter((e) => e.id !== id));
    } else {
      toast.error(result.message);
    }
  };

  const handleSuccess = () => {
    setEditDialogOpen(false);
    setSelectedEmployee(undefined);
    if (onChanged) onChanged();
    else window.location.reload();
  };

  // Figures from the employee records themselves.
  const stats = useMemo(() => {
    const now = new Date();
    const hired = employees.filter((e) => e.hireDate);
    const months = hired.map((e) => tenureMonths(e.hireDate!, now));
    const newest = [...hired].sort((a, b) => new Date(b.hireDate!).getTime() - new Date(a.hireDate!).getTime())[0];
    return {
      payroll: employees.reduce((sum, e) => sum + Number(e.salary || 0), 0),
      averageMonths: months.length ? Math.round(months.reduce((sum, m) => sum + m, 0) / months.length) : null,
      withoutHireDate: employees.length - hired.length,
      newest,
      anniversaries: upcomingAnniversaries(employees, now).slice(0, 5),
    };
  }, [employees]);

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="کارمندان"
          icon={Users}
          value={fa(employees.length)}
          unit="نفر"
          note={stats.newest ? `جدیدترین: ${stats.newest.name} · ${formatJalaliDate(stats.newest.hireDate)}` : undefined}
        />
        <KpiCard
          label="جمع حقوق ماهانه"
          icon={Wallet}
          value={fa(stats.payroll)}
          unit="تومان"
          note="حقوق ثبت‌شده در پروندهٔ کارمندان"
        />
        <KpiCard
          label="میانگین سابقه"
          icon={CalendarDays}
          value={stats.averageMonths === null ? '—' : tenureLabel(stats.averageMonths)}
          note={
            stats.averageMonths === null
              ? 'تاریخ استخدام کسی ثبت نشده'
              : stats.withoutHireDate > 0
                ? `${fa(stats.withoutHireDate)} نفر بدون تاریخ استخدام`
                : 'از تاریخ استخدام'
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div>
          {employees.length === 0 ? (
            <div className="rounded-lg border bg-card px-4 py-10 text-center text-[13px] text-muted-foreground">
              هنوز کارمندی ثبت نشده است.
              {canManage && ' با «افزودن کارمند» اولین نفر را تعریف کنید؛ بعد می‌توانید برایش فیش حقوقی بزنید.'}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {employees.map((employee) => (
                <div key={employee.id} className="flex flex-col gap-3 rounded-lg border bg-card p-4 transition-colors duration-150 hover:border-input">
                  <div className="flex items-start gap-3">
                    <Initial name={employee.name} />
                    <div className="min-w-0 flex-1">
                      <h4 className="truncate text-sm font-medium">{employee.name}</h4>
                      <p className="truncate text-xs text-muted-foreground">{employee.position || 'بدون سمت'}</p>
                    </div>
                    {canManage && (
                      <div className="-me-1 -mt-1 flex shrink-0">
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="ویرایش" onClick={() => handleEdit(employee)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-danger" title="حذف">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>حذف «{employee.name}»</AlertDialogTitle>
                              <AlertDialogDescription>
                                آیا از حذف {employee.name} اطمینان دارید؟ این عمل قابل بازگشت نیست. کارمندی که وام ثبت‌شده دارد حذف نمی‌شود.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>لغو</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(employee.id)}
                                className={buttonVariants({ variant: 'destructive' })}
                              >
                                حذف {employee.name}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
                  </div>

                  <dl className="space-y-1.5 border-t pt-3 text-[12.5px]">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">کد ملی</dt>
                      <dd className="font-mono text-[12px]">{employee.nationalId || '—'}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">تلفن</dt>
                      <dd className="font-mono text-[12px]" dir="ltr">{employee.phone || '—'}</dd>
                    </div>
                    {employee.email && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">ایمیل</dt>
                        <dd className="min-w-0 truncate font-mono text-[12px]" dir="ltr">{employee.email}</dd>
                      </div>
                    )}
                    {employee.address && (
                      <div className="flex justify-between gap-3">
                        <dt className="shrink-0 text-muted-foreground">آدرس</dt>
                        <dd className="line-clamp-2 text-end">{employee.address}</dd>
                      </div>
                    )}
                  </dl>

                  <div className="mt-auto flex items-end justify-between gap-3 border-t pt-3">
                    <div>
                      <p className="text-[11.5px] text-muted-foreground">حقوق ماهانه (تومان)</p>
                      <p className="text-[15px] font-medium tabular-nums">{fa(employee.salary)}</p>
                    </div>
                    <div className="text-end text-[11.5px] text-muted-foreground">
                      {employee.hireDate ? (
                        <>
                          <p className="font-mono">{formatJalaliDate(employee.hireDate)}</p>
                          <p>{tenureLabel(tenureMonths(employee.hireDate))} سابقه</p>
                        </>
                      ) : (
                        <p>تاریخ استخدام ثبت نشده</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <SectionCard title="سالگردهای کاری" count={stats.anniversaries.length ? stats.anniversaries.length.toLocaleString('fa-IR') : undefined}>
          {stats.anniversaries.length === 0 ? (
            <p className="py-4 text-center text-[12.5px] text-muted-foreground">
              تاریخ استخدام هیچ کارمندی ثبت نشده؛ با ویرایش کارمند آن را وارد کنید تا سالگردش اینجا بیاید.
            </p>
          ) : (
            <ul className="divide-y">
              {stats.anniversaries.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2.5">
                  <Initial name={a.name} className="h-8 w-8 text-[13px]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{a.name}</p>
                    <p className="text-[11.5px] text-muted-foreground">
                      {fa(a.years)} سال · {formatJalaliDateShort(a.date)}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[11.5px]',
                      a.days === 0 ? 'bg-brand-soft text-brand' : 'bg-secondary text-muted-foreground',
                    )}
                  >
                    {a.days === 0 ? 'امروز' : a.days === 1 ? 'فردا' : `${fa(a.days)} روز دیگر`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {selectedEmployee && (
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>ویرایش کارمند — {selectedEmployee.name}</DialogTitle>
            </DialogHeader>
            <EmployeeForm initialData={selectedEmployee} onSuccess={handleSuccess} />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
