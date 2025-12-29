'use client';

import { useState, useEffect } from 'react';
import moment from 'moment-jalaali';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { formatJalaliDate, parseJalaliDate } from '@/lib/date-utils';

interface JalaliDatePickerProps {
  name: string;
  label?: string;
  defaultValue?: Date | string;
  onChange?: (date?: Date) => void;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}

// Simple Jalali calendar grid component
function JalaliCalendar({
  selectedDate,
  onSelect
}: {
  selectedDate?: Date;
  onSelect: (date: Date) => void;
}) {
  const [currentMonth, setCurrentMonth] = useState(
    selectedDate ? moment(selectedDate) : moment()
  );

  const startOfMonth = currentMonth.clone().startOf('jMonth');
  const endOfMonth = currentMonth.clone().endOf('jMonth');
  const startDate = startOfMonth.clone().startOf('week');
  const endDate = endOfMonth.clone().endOf('week');

  const calendar: Date[][] = [];
  let week: Date[] = [];
  
  for (let day = startDate.clone(); day.isSameOrBefore(endDate); day.add(1, 'day')) {
    week.push(day.toDate());
    if (week.length === 7) {
      calendar.push(week);
      week = [];
    }
  }

  const monthName = currentMonth.format('jMMMM jYYYY');
  const weekDays = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentMonth(currentMonth.clone().subtract(1, 'jMonth'))}
        >
          →
        </Button>
        <div className="font-semibold">{monthName}</div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentMonth(currentMonth.clone().add(1, 'jMonth'))}
        >
          ←
        </Button>
      </div>
      
      <div className="grid grid-cols-7 gap-1 mb-2">
        {weekDays.map((day) => (
          <div key={day} className="text-center text-sm font-medium text-muted-foreground p-2">
            {day}
          </div>
        ))}
      </div>
      
      <div className="grid grid-cols-7 gap-1">
        {calendar.flat().map((date, index) => {
          const isCurrentMonth = moment(date).jMonth() === currentMonth.jMonth();
          const isSelected = selectedDate && moment(date).isSame(selectedDate, 'day');
          const isToday = moment(date).isSame(moment(), 'day');
          
          return (
            <Button
              key={index}
              variant={isSelected ? 'default' : 'ghost'}
              size="sm"
              className={cn(
                'h-9 w-9 p-0 font-normal',
                !isCurrentMonth && 'text-muted-foreground opacity-50',
                isToday && !isSelected && 'border border-primary',
                isSelected && 'bg-primary text-primary-foreground hover:bg-primary/90'
              )}
              onClick={() => onSelect(date)}
            >
              {moment(date).jDate()}
            </Button>
          );
        })}
      </div>
      
      <div className="mt-3 pt-3 border-t">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => onSelect(new Date())}
        >
          امروز
        </Button>
      </div>
    </div>
  );
}

export function JalaliDatePicker({
  name,
  label,
  defaultValue,
  onChange,
  required = false,
  disabled = false,
  className,
  placeholder = 'انتخاب تاریخ...'
}: JalaliDatePickerProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    defaultValue ? (typeof defaultValue === 'string' ? new Date(defaultValue) : defaultValue) : undefined
  );
  const [open, setOpen] = useState(false);

  // Update selectedDate when defaultValue changes
  useEffect(() => {
    if (defaultValue) {
      const newDate = typeof defaultValue === 'string' ? new Date(defaultValue) : defaultValue;
      setSelectedDate(newDate);
    } else {
      setSelectedDate(undefined);
    }
  }, [defaultValue]);

  const handleSelect = (date: Date) => {
    setSelectedDate(date);
    setOpen(false);
    if (onChange) {
      onChange(date);
    }
  };

  const displayValue = selectedDate ? formatJalaliDate(selectedDate) : '';

  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <Label htmlFor={name} className="text-base md:text-sm">
          {label}
          {required && <span className="text-red-500 mr-1">*</span>}
        </Label>
      )}
      
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              'w-full justify-start text-right font-normal h-12 md:h-10 text-base md:text-sm',
              !selectedDate && 'text-muted-foreground'
            )}
            disabled={disabled}
          >
            <Calendar className="ml-2 h-5 w-5 md:h-4 md:w-4" />
            {displayValue || placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <JalaliCalendar selectedDate={selectedDate} onSelect={handleSelect} />
        </PopoverContent>
      </Popover>

      {/* Hidden input for form submission */}
      <input
        type="hidden"
        name={name}
        value={selectedDate ? selectedDate.toISOString() : ''}
        required={required}
      />
    </div>
  );
}
