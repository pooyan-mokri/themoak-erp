'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createMarketingCampaign } from '@/actions/marketing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { useState } from 'react';

const initialState: {
  message: string;
  errors: Record<string, string[]>;
} = {
  message: '',
  errors: {},
};

const campaignTypes = [
  { value: 'SOCIAL_MEDIA', label: 'شبکه‌های اجتماعی' },
  { value: 'EMAIL', label: 'ایمیل' },
  { value: 'PRINT', label: 'چاپی' },
  { value: 'EVENT', label: 'رویداد' },
  { value: 'OTHER', label: 'سایر' },
];

const campaignStatuses = [
  { value: 'PLANNED', label: 'برنامه‌ریزی شده' },
  { value: 'ACTIVE', label: 'فعال' },
  { value: 'COMPLETED', label: 'تکمیل شده' },
  { value: 'CANCELLED', label: 'لغو شده' },
];

export function CampaignForm() {
  const [state, dispatch] = useFormState(createMarketingCampaign, initialState);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  return (
    <Card>
      <CardHeader>
        <CardTitle>ایجاد کمپین بازاریابی</CardTitle>
      </CardHeader>
      <form action={dispatch}>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name">نام کمپین *</Label>
              <Input
                id="name"
                name="name"
                placeholder="مثال: کمپین وفاداری مشتریان"
                required
              />
              {state.errors && 'name' in state.errors && state.errors.name?.[0] && (
                <p className="text-red-500 text-sm">{state.errors.name[0]}</p>
              )}
            </div>

            {/* Type */}
            <div className="space-y-2">
              <Label htmlFor="type">نوع کمپین *</Label>
              <Select name="type" required>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب نوع" />
                </SelectTrigger>
                <SelectContent>
                  {campaignTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {state.errors && 'type' in state.errors && state.errors.type?.[0] && (
                <p className="text-red-500 text-sm">{state.errors.type[0]}</p>
              )}
            </div>

            {/* Start Date */}
            <div className="space-y-2">
              <Label htmlFor="startDate">تاریخ شروع *</Label>
              <JalaliDatePicker
                name="startDate"
                defaultValue={startDate ? new Date(startDate) : null}
                onChange={(selectedDate) => {
                  setStartDate(selectedDate ? selectedDate.toISOString().split('T')[0] : '');
                }}
              />
              <input type="hidden" name="startDate" value={startDate} />
              {state.errors && 'startDate' in state.errors && state.errors.startDate?.[0] && (
                <p className="text-red-500 text-sm">{state.errors.startDate[0]}</p>
              )}
            </div>

            {/* End Date */}
            <div className="space-y-2">
              <Label htmlFor="endDate">تاریخ پایان (اختیاری)</Label>
              <JalaliDatePicker
                name="endDate"
                defaultValue={endDate ? new Date(endDate) : null}
                onChange={(selectedDate) => {
                  setEndDate(selectedDate ? selectedDate.toISOString().split('T')[0] : '');
                }}
              />
              <input type="hidden" name="endDate" value={endDate} />
            </div>

            {/* Budget */}
            <div className="space-y-2">
              <Label htmlFor="budget">بودجه (تومان) (اختیاری)</Label>
              <Input
                id="budget"
                name="budget"
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
              />
            </div>

            {/* Status */}
            <div className="space-y-2">
              <Label htmlFor="status">وضعیت</Label>
              <Select name="status" defaultValue="PLANNED">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {campaignStatuses.map((status) => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">توضیحات (اختیاری)</Label>
            <Textarea
              id="description"
              name="description"
              placeholder="توضیحات کمپین..."
              rows={3}
            />
          </div>

          {state.message && (
            <div
              className={`text-sm p-3 rounded ${
                Object.keys(state.errors || {}).length === 0
                  ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200'
                  : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200'
              }`}
            >
              {state.message}
            </div>
          )}
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
      {pending ? 'در حال ثبت...' : 'ایجاد کمپین'}
    </Button>
  );
}

