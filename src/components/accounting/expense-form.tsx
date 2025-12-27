'use client';

import { useState, useEffect } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { recordExpense } from '@/actions/accounting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Currency } from '@/lib/types';
import { ReceiptUpload } from './receipt-upload';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';

const initialState = {
  message: '',
  errors: {},
};

interface Account {
  id: string;
  name: string;
  currency: string;
}

interface Project {
  id: string;
  name: string;
}

interface Employee {
  id: string;
  name: string;
}

export function ExpenseForm({ accounts, projects = [], employees = [] }: { accounts: Account[], projects?: Project[], employees?: Employee[] }) {
  const router = useRouter();
  const [state, dispatch] = useFormState(recordExpense, initialState);
  const [receiptUrl, setReceiptUrl] = useState('');
  const [receiptType, setReceiptType] = useState('');
  const [currency, setCurrency] = useState<string>('TOMAN');
  const [category, setCategory] = useState<string>('');
  const [paymentSource, setPaymentSource] = useState<'account' | 'employee'>('account');
  const [accountId, setAccountId] = useState<string>('');
  const [employeeId, setEmployeeId] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');

  // Redirect to expenses list after successful submission
  useEffect(() => {
    if (state.message && state.message.includes('موفقیت')) {
      const timer = setTimeout(() => {
        router.push('/dashboard/accounting/expenses');
      }, 1000); // Wait 1 second to show success message
      return () => clearTimeout(timer);
    }
  }, [state.message, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>ثبت هزینه جدید</CardTitle>
      </CardHeader>
      <form action={dispatch}>
        <CardContent className="space-y-5 md:space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount" className="text-base md:text-sm">مبلغ</Label>
              <Input 
                id="amount" 
                name="amount" 
                type="number" 
                placeholder="0" 
                required 
                className="h-12 md:h-10 text-base md:text-sm"
              />
              {(state.errors as Record<string, string[] | undefined> | undefined)?.amount && <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.amount}</p>}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="currency" className="text-base md:text-sm">ارز</Label>
              <Select name="currency" required value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="h-12 md:h-10 text-base md:text-sm">
                  <SelectValue placeholder="انتخاب کنید" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={Currency.TOMAN}>تومان</SelectItem>
                  <SelectItem value={Currency.USD}>دلار</SelectItem>
                  <SelectItem value={Currency.EUR}>یورو</SelectItem>
                  <SelectItem value={Currency.CNY}>یوآن</SelectItem>
                </SelectContent>
              </Select>
              <input type="hidden" name="currency" value={currency} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category" className="text-base md:text-sm">دسته‌بندی</Label>
              <Select name="category" required value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-12 md:h-10 text-base md:text-sm">
                  <SelectValue placeholder="انتخاب کنید" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Rent">اجاره</SelectItem>
                  <SelectItem value="Salary">حقوق</SelectItem>
                  <SelectItem value="Marketing">مارکتینگ</SelectItem>
                  <SelectItem value="Office">اداری</SelectItem>
                  <SelectItem value="Transport">حمل و نقل</SelectItem>
                  <SelectItem value="Other">سایر</SelectItem>
                </SelectContent>
              </Select>
              <input type="hidden" name="category" value={category} />
            </div>

            <div className="space-y-2">
              <Label className="text-base md:text-sm">نحوه پرداخت</Label>
              <Select value={paymentSource} onValueChange={(value: 'account' | 'employee') => {
                setPaymentSource(value);
                setAccountId('');
                setEmployeeId('');
              }}>
                <SelectTrigger className="h-12 md:h-10 text-base md:text-sm">
                  <SelectValue placeholder="انتخاب کنید" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="account">پرداخت از حساب</SelectItem>
                  <SelectItem value="employee">پرداخت از حساب شخصی کارمند</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {paymentSource === 'account' && (
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="accountId" className="text-base md:text-sm">حساب پرداخت</Label>
                <Select name="accountId" required={paymentSource === 'account'} value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger className="h-12 md:h-10 text-base md:text-sm">
                    <SelectValue placeholder="انتخاب حساب" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.name} ({acc.currency})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {paymentSource === 'employee' && (
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="employeeId" className="text-base md:text-sm">کارمند پرداخت‌کننده</Label>
                <Select name="employeeId" required={paymentSource === 'employee'} value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger className="h-12 md:h-10 text-base md:text-sm">
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
              </div>
            )}

            <input type="hidden" name="accountId" value={paymentSource === 'account' ? accountId : ''} />
            <input type="hidden" name="employeeId" value={paymentSource === 'employee' ? employeeId : ''} />
            
            <div className="space-y-2">
                <JalaliDatePicker 
                    name="date" 
                    label="تاریخ"
                    defaultValue={new Date()}
                />
            </div>

            <div className="space-y-2">
              <Label htmlFor="projectId" className="text-base md:text-sm">پروژه (اختیاری)</Label>
              <Select name="projectId" value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="h-12 md:h-10 text-base md:text-sm">
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

            <div className="space-y-2 md:col-span-2">
                <Label className="text-base md:text-sm">رسید / فاکتور (اختیاری)</Label>
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
          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className="text-base md:text-sm">توضیحات</Label>
            <Textarea 
              id="description" 
              name="description" 
              placeholder="توضیحات تکمیلی..." 
              className="min-h-[120px] md:min-h-[100px] text-base md:text-sm"
              rows={5}
            />
          </div>

          {state.message && (
            <div className={`text-sm p-2 rounded ${state.message.includes('موفقیت') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {state.message}
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-end pt-4">
          <SubmitButton />
        </CardFooter>
      </form>
    </Card>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button 
      type="submit" 
      disabled={pending}
      className="h-14 md:h-10 w-full md:w-auto text-base md:text-sm font-semibold"
    >
      {pending ? 'در حال ثبت...' : 'ثبت هزینه'}
    </Button>
  );
}
