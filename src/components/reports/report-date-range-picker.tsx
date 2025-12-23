'use client';

import { useState } from 'react';
import { format } from 'date-fns-jalali';
import { Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface DateRange {
  from: Date;
  to: Date;
}

interface ReportDateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

export function ReportDateRangePicker({ value, onChange }: ReportDateRangePickerProps) {
  const formatDate = (date: Date) => {
    return date.toISOString().split('T')[0]; // YYYY-MM-DD for input
  };

  const presets = [
    {
      label: 'ماه جاری',
      getValue: () => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return { from: start, to: end };
      },
    },
    {
      label: 'ماه گذشته',
      getValue: () => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 0);
        return { from: start, to: end };
      },
    },
    {
      label: '3 ماه اخیر',
      getValue: () => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        return { from: start, to: now };
      },
    },
    {
      label: 'سال جاری',
      getValue: () => {
        const now = new Date();
        const start = new Date(now.getFullYear(), 0, 1);
        return { from: start, to: now };
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2 flex-wrap">
        {presets.map((preset) => (
          <Button
            key={preset.label}
            variant="outline"
            size="sm"
            onClick={() => onChange(preset.getValue())}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>از تاریخ</Label>
          <Input
            type="date"
            value={formatDate(value.from)}
            onChange={(e) => onChange({ ...value, from: new Date(e.target.value) })}
          />
        </div>
        <div className="space-y-2">
          <Label>تا تاریخ</Label>
          <Input
            type="date"
            value={formatDate(value.to)}
            onChange={(e) => onChange({ ...value, to: new Date(e.target.value) })}
            min={formatDate(value.from)}
          />
        </div>
      </div>
    </div>
  );
}
