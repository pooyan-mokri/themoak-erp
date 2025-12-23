'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createPromotion } from '@/actions/promotion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

const initialState: {
  errors?: Record<string, string[]>;
  message: string;
  success?: boolean;
} = {
  message: '',
};

export function PromotionForm() {
  const router = useRouter();
  const [state, dispatch] = useFormState(createPromotion, initialState);

  useEffect(() => {
    if (state.message && state.success) {
      toast.success(state.message);
      router.push('/dashboard/crm/promotions');
    } else if (state.message && !state.success) {
      toast.error(state.message);
    }
  }, [state, router]);

  return (
    <Card>
        <CardHeader>
            <CardTitle>ایجاد کمپین تبلیغاتی جدید</CardTitle>
        </CardHeader>
        <form action={dispatch}>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="name">نام کمپین</Label>
                        <Input id="name" name="name" placeholder="مثال: فروش ویژه تابستان" required />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="type">نوع</Label>
                        <Select name="type" defaultValue="DISCOUNT">
                            <SelectTrigger>
                                <SelectValue placeholder="انتخاب کنید" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="DISCOUNT">تخفیف</SelectItem>
                                <SelectItem value="GIFT">هدیه</SelectItem>
                                <SelectItem value="VOUCHER">کد اعتباری</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="discountPercent">درصد تخفیف (اختیاری)</Label>
                        <Input id="discountPercent" name="discountPercent" type="number" placeholder="مثال: 10" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="discountAmount">مبلغ تخفیف (اختیاری)</Label>
                        <Input id="discountAmount" name="discountAmount" type="number" placeholder="مثال: 50000" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="maxUses">حداکثر تعداد استفاده (اختیاری)</Label>
                        <Input id="maxUses" name="maxUses" type="number" placeholder="نامحدود" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="minPurchase">حداقل مبلغ خرید (اختیاری)</Label>
                        <Input id="minPurchase" name="minPurchase" type="number" placeholder="0" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="startDate">تاریخ شروع</Label>
                        <Input id="startDate" name="startDate" type="date" required />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="endDate">تاریخ پایان</Label>
                        <Input id="endDate" name="endDate" type="date" required />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="description">توضیحات (اختیاری)</Label>
                        <Input id="description" name="description" placeholder="توضیحات داخلی..." />
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
      {pending ? 'در حال ایجاد...' : 'ایجاد کمپین'}
    </Button>
  );
}

