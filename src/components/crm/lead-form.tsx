'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createLead } from '@/actions/crm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

const initialState: {
  errors?: Record<string, string[]>;
  message: string;
  success?: boolean;
} = {
  message: '',
};

export function LeadForm() {
  const router = useRouter();
  const [state, dispatch] = useFormState(createLead, initialState);

  useEffect(() => {
    if (state.message && state.success) {
      toast.success(state.message);
      router.push('/dashboard/crm/leads');
    } else if (state.message && !state.success) {
      toast.error(state.message);
    }
  }, [state, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>ایجاد سرنخ جدید</CardTitle>
      </CardHeader>
      <form action={dispatch}>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">نام *</Label>
              <Input id="name" name="name" placeholder="نام کامل" required />
              {(state.errors as Record<string, string[] | undefined> | undefined)?.name && <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.name[0]}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="company">نام شرکت</Label>
              <Input id="company" name="company" placeholder="نام شرکت (اختیاری)" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">شماره تماس</Label>
              <Input id="phone" name="phone" placeholder="0912..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">ایمیل</Label>
              <Input id="email" name="email" type="email" placeholder="example@mail.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="source">منبع</Label>
              <Select name="source">
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب کنید" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WEBSITE">وبسایت</SelectItem>
                  <SelectItem value="REFERRAL">معرفی</SelectItem>
                  <SelectItem value="COLD_CALL">تماس سرد</SelectItem>
                  <SelectItem value="SOCIAL_MEDIA">شبکه‌های اجتماعی</SelectItem>
                  <SelectItem value="ADVERTISEMENT">تبلیغات</SelectItem>
                  <SelectItem value="OTHER">سایر</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="expectedValue">ارزش مورد انتظار (تومان)</Label>
              <Input id="expectedValue" name="expectedValue" type="number" placeholder="0" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="notes">یادداشت‌ها</Label>
              <Textarea id="notes" name="notes" placeholder="یادداشت‌ها..." rows={3} />
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-end">
          <SubmitButton />
        </CardFooter>
      </form>
    </Card>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'در حال ایجاد...' : 'ایجاد سرنخ'}
    </Button>
  );
}
