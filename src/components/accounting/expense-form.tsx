'use client';

import { useState, useEffect } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { recordExpense } from '@/actions/accounting';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Currency } from '@/lib/types';
import { ReceiptUpload } from './receipt-upload';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { RequestIdField, useRequestId } from '@/components/ui/request-id';
import { accountLabel } from '@/lib/account-label';
import { cn } from '@/lib/utils';
import { EXPENSE_CATEGORIES } from './entry-categories';
import { SectionCard } from '@/components/dashboard/section-card';
import { AmountField, BalancePreview, RecentEntries, SubmitShortcut, type RecentEntry } from './entry-parts';

const initialState = {
  message: '',
  errors: {},
  success: false,
};

interface Account {
  id: string;
  name: string;
  currency: string;
  cardNumber?: string | null;
  /** Loaded with the accounts (finance.view); shown as the balance before and after. */
  balance?: number;
}

interface Project {
  id: string;
  name: string;
}

interface Employee {
  id: string;
  name: string;
}

/** A recent expense; picking it fills the form with its source, category and amount. */
export type RecentExpense = RecentEntry & {
  fill: { accountId?: string; employeeId?: string; category: string };
};

export function ExpenseForm({
  accounts,
  projects = [],
  employees = [],
  recent,
}: {
  accounts: Account[];
  projects?: Project[];
  employees?: Employee[];
  /** Given on the new-expense page, which then shows the preview and the recent entries beside the form. */
  recent?: RecentExpense[];
}) {
  const router = useRouter();
  const [state, dispatch] = useFormState(recordExpense, initialState);
  const [requestId, renewRequestId] = useRequestId();
  const [receiptUrl, setReceiptUrl] = useState('');
  const [receiptType, setReceiptType] = useState('');
  // Paid from an account, the currency follows that account; there is no default to forget.
  const [currency, setCurrency] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [paymentSource, setPaymentSource] = useState<'account' | 'employee'>('account');
  const [accountId, setAccountId] = useState<string>('');
  const [employeeId, setEmployeeId] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [amount, setAmount] = useState('');
  const selectedAccount = accounts.find((acc) => acc.id === accountId);
  const errors = state.errors as Record<string, string[] | undefined> | undefined;

  // After a save the form is emptied at once and gets a new id, so the entry
  // cannot be sent a second time while the success message shows; then back
  // to the expenses list.
  useEffect(() => {
    if (state.success) {
      setReceiptUrl('');
      setReceiptType('');
      setCurrency('');
      setCategory('');
      setPaymentSource('account');
      setAccountId('');
      setEmployeeId('');
      setProjectId('');
      setAmount('');
      renewRequestId();
      const timer = setTimeout(() => {
        router.push('/dashboard/accounting/expenses');
      }, 1000); // Wait 1 second to show success message
      return () => clearTimeout(timer);
    }
  }, [state, router, renewRequestId]);

  const repeat = (entry: RecentExpense) => {
    setCategory(entry.fill.category);
    if (entry.fill.employeeId) {
      setPaymentSource('employee');
      setEmployeeId(entry.fill.employeeId);
      setAccountId('');
    } else if (entry.fill.accountId) {
      setPaymentSource('account');
      setAccountId(entry.fill.accountId);
      setEmployeeId('');
    }
    setCurrency(entry.currency);
    setAmount(String(entry.amount));
  };

  const employee = employees.find((emp) => emp.id === employeeId);
  const preview =
    paymentSource === 'employee' ? (
      <p className="text-[12.5px] text-muted-foreground">
        {employee
          ? `از جیب ${employee.name} پرداخت شده: بدهی شرکت به او ثبت می‌شود و از موجودی حسابی کم نمی‌شود.`
          : 'کارمندی که پرداخت کرده را انتخاب کنید؛ بدهی شرکت به او ثبت می‌شود.'}
      </p>
    ) : (
      <BalancePreview
        account={selectedAccount && selectedAccount.balance !== undefined ? { ...selectedAccount, balance: selectedAccount.balance } : undefined}
        amount={Number(amount)}
        currency={currency}
        direction={-1}
      />
    );

  return (
    <div className={cn('grid items-start gap-4', recent && 'lg:grid-cols-[minmax(0,1fr)_320px]')}>
      <div className="rounded-lg border bg-card">
        <form key={requestId} action={dispatch}>
          <RequestIdField value={requestId} />
          <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5 [&_label]:text-xs [&_label]:text-muted-foreground">
            <div className="sm:col-span-2">
              <AmountField value={amount} onValueChange={setAmount} currency={currency} placeholder="0" required error={errors?.amount?.[0]} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="currency" className="text-xs text-muted-foreground">ارز</Label>
              <Select name="currency" required value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue placeholder={paymentSource === 'account' ? 'ارز حساب' : 'انتخاب کنید'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={Currency.TOMAN}>تومان</SelectItem>
                  <SelectItem value={Currency.USD}>دلار</SelectItem>
                  <SelectItem value={Currency.EUR}>یورو</SelectItem>
                  <SelectItem value={Currency.CNY}>یوآن</SelectItem>
                </SelectContent>
              </Select>
              <input type="hidden" name="currency" value={currency} />
              {selectedAccount && currency && currency !== selectedAccount.currency && (
                <p className="text-xs text-muted-foreground">
                  مبلغ به {currency} وارد می‌شود و با آخرین نرخ به ارز حساب ({selectedAccount.currency}) تبدیل می‌شود.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">نحوه پرداخت</Label>
              <Select value={paymentSource} onValueChange={(value: 'account' | 'employee') => {
                setPaymentSource(value);
                setAccountId('');
                setEmployeeId('');
                // An employee's out-of-pocket expense is a Toman debt unless said otherwise.
                setCurrency(value === 'employee' ? 'TOMAN' : '');
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب کنید" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="account">پرداخت از حساب</SelectItem>
                  <SelectItem value="employee">پرداخت از حساب شخصی کارمند</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {paymentSource === 'account' && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="accountId" className="text-xs text-muted-foreground">حساب پرداخت</Label>
                <Select
                  name="accountId"
                  required={paymentSource === 'account'}
                  value={accountId}
                  onValueChange={(id) => {
                    setAccountId(id);
                    setCurrency(accounts.find((acc) => acc.id === id)?.currency ?? '');
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="انتخاب حساب" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {accountLabel(acc)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors?.accountId && <p className="text-xs text-danger">{errors.accountId[0]}</p>}
              </div>
            )}

            {paymentSource === 'employee' && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="employeeId" className="text-xs text-muted-foreground">کارمند پرداخت‌کننده</Label>
                <Select name="employeeId" required={paymentSource === 'employee'} value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="انتخاب کارمند" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((emp) => (
                      <SelectItem key={emp.id} value={emp.id}>
                        {emp.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11.5px] text-muted-foreground">پرداخت از جیب کارمند، بدهی شرکت به او ثبت می‌شود.</p>
              </div>
            )}

            <input type="hidden" name="accountId" value={paymentSource === 'account' ? accountId : ''} />
            <input type="hidden" name="employeeId" value={paymentSource === 'employee' ? employeeId : ''} />

            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs text-muted-foreground">دسته‌بندی</Label>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="دسته‌بندی">
                {EXPENSE_CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    role="radio"
                    aria-checked={category === c.value}
                    onClick={() => setCategory(c.value)}
                    className={cn(
                      'h-8 rounded-full border px-3 text-[12.5px] transition-colors duration-150',
                      category === c.value ? 'border-brand bg-brand-soft font-medium text-brand' : 'bg-card text-muted-foreground hover:border-foreground/40',
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <input type="hidden" name="category" value={category} />
              {errors?.category && <p className="text-xs text-danger">{errors.category[0]}</p>}
            </div>

            <div className="space-y-1.5">
              <JalaliDatePicker
                name="date"
                label="تاریخ"
                defaultValue={new Date()}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="projectId" className="text-xs text-muted-foreground">پروژه (اختیاری)</Label>
              <Select name="projectId" value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب پروژه" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون پروژه</SelectItem>
                  {projects.map((proj) => (
                    <SelectItem key={proj.id} value={proj.id}>
                      {proj.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name="projectId" value={projectId} />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="description" className="text-xs text-muted-foreground">توضیحات</Label>
              <Textarea
                id="description"
                name="description"
                placeholder="توضیح کوتاه برای دفتر روزنامه"
                rows={3}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs text-muted-foreground">رسید / فاکتور (اختیاری)</Label>
              <input type="hidden" name="receiptUrl" value={receiptUrl} />
              <input type="hidden" name="receiptType" value={receiptType} />
              <ReceiptUpload
                onUploadComplete={(url, type) => {
                  setReceiptUrl(url);
                  setReceiptType(type);
                }}
                onRemove={() => {
                  setReceiptUrl('');
                  setReceiptType('');
                }}
                currentUrl={receiptUrl}
                currentType={receiptType}
              />
            </div>

            {!recent && <div className="rounded-md bg-secondary p-3 sm:col-span-2">{preview}</div>}

            {state.message && (
              <div
                className={cn(
                  'rounded-md px-3 py-2 text-[13px] sm:col-span-2',
                  state.success ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
                )}
              >
                {state.message}
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-3 border-t px-4 py-3 sm:px-5">
            <SubmitShortcut />
            <SubmitButton />
          </div>
        </form>
      </div>

      {recent && (
        <div className="space-y-4">
          <SectionCard title="پیش‌نمایش">{preview}</SectionCard>
          <SectionCard title="هزینه‌های اخیر" aside={<span className="text-muted-foreground">برای تکرار بزنید</span>}>
            <RecentEntries entries={recent} onPick={repeat} empty="در ۳۰ روز گذشته هزینه‌ای با این فرم ثبت نشده است." />
          </SectionCard>
        </div>
      )}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      {pending ? 'در حال ثبت...' : 'ثبت هزینه'}
    </Button>
  );
}
