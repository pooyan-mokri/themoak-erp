'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, ChevronLeft, Calendar as CalendarIcon } from 'lucide-react';
import moment from 'moment-jalaali';
import { formatJalaliDate } from '@/lib/date-utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  startDate?: string;
  dueDate?: string;
  assignedTo?: {
    id: string;
    name: string;
  };
}

interface ProjectCalendarViewProps {
  tasks: Task[];
  projectId: string;
  projectStartDate?: string;
  projectEndDate?: string;
}

const jalaliMonths = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

const jalaliWeekDays = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

const priorityColors: Record<string, string> = {
  LOW: 'bg-blue-100 text-blue-700 border-blue-200',
  MEDIUM: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  HIGH: 'bg-orange-100 text-orange-700 border-orange-200',
  URGENT: 'bg-red-100 text-red-700 border-red-200',
};

const statusColors: Record<string, string> = {
  TODO: 'bg-gray-100 text-gray-700 border-gray-200',
  IN_PROGRESS: 'bg-blue-100 text-blue-700 border-blue-200',
  REVIEW: 'bg-purple-100 text-purple-700 border-purple-200',
  DONE: 'bg-green-100 text-green-700 border-green-200',
};

const statusLabels: Record<string, string> = {
  TODO: 'انجام نشده',
  IN_PROGRESS: 'در حال انجام',
  REVIEW: 'در حال بررسی',
  DONE: 'انجام شده',
};

const priorityLabels: Record<string, string> = {
  LOW: 'کم',
  MEDIUM: 'متوسط',
  HIGH: 'زیاد',
  URGENT: 'فوری',
};

export function ProjectCalendarView({ tasks, projectId, projectStartDate, projectEndDate }: ProjectCalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(moment());

  const currentMonth = currentDate.jMonth();
  const currentYear = currentDate.jYear();

  // Get tasks with due dates
  const tasksWithDates = useMemo(() => {
    return tasks.filter((task) => {
      // Check if dueDate exists and is not null/undefined
      if (!task.dueDate) return false;
      
      // Convert to Date if it's a string
      const date = typeof task.dueDate === 'string' ? new Date(task.dueDate) : task.dueDate;
      
      // Check if date is valid
      return date instanceof Date && !isNaN(date.getTime());
    });
  }, [tasks]);

  // Group tasks by date
  const eventsByDate = useMemo(() => {
    const events: Record<string, Task[]> = {};

    tasksWithDates.forEach((task) => {
      if (task.dueDate) {
        try {
          // Ensure dueDate is a Date object
          const date = typeof task.dueDate === 'string' ? new Date(task.dueDate) : task.dueDate;
          
          // Check if date is valid
          if (date instanceof Date && !isNaN(date.getTime())) {
            // Use moment to convert to Jalali, ensuring we use the date part only (no time)
            const jalaliMoment = moment(date).startOf('day');
            const dateKey = jalaliMoment.format('jYYYY/jMM/jDD');
            if (!events[dateKey]) {
              events[dateKey] = [];
            }
            events[dateKey].push(task);
          }
        } catch (error) {
          console.error('Error processing task dueDate:', error, task);
        }
      }
    });

    return events;
  }, [tasksWithDates]);

  // Debug: Log tasks and events (only in development)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('ProjectCalendarView Debug:', {
        totalTasks: tasks.length,
        tasksWithDates: tasksWithDates.length,
        eventsByDateKeys: Object.keys(eventsByDate),
        eventsByDate: eventsByDate,
        sampleTask: tasks[0],
        sampleTaskDueDate: tasks[0]?.dueDate,
        sampleTaskDueDateType: typeof tasks[0]?.dueDate,
      });
    }
  }, [tasks, tasksWithDates, eventsByDate]);

  // Generate calendar days
  const calendarDays = useMemo(() => {
    // Get first day of month and number of days
    const firstDayOfMonth = moment(`${currentYear}/${currentMonth + 1}/1`, 'jYYYY/jMM/jDD');
    const daysInMonth = moment.jDaysInMonth(currentYear, currentMonth);
    const firstDayWeekday = firstDayOfMonth.day(); // 0 = Saturday, 6 = Friday

    // Adjust for Jalali week (Saturday = 0)
    const adjustedFirstDay = firstDayWeekday === 6 ? 0 : firstDayWeekday + 1;

    // Convert project dates to Date objects
    const startDate = projectStartDate ? (typeof projectStartDate === 'string' ? new Date(projectStartDate) : projectStartDate) : null;
    const endDate = projectEndDate ? (typeof projectEndDate === 'string' ? new Date(projectEndDate) : projectEndDate) : null;

    const days: Array<{
      date: moment.Moment;
      day: number;
      isCurrentMonth: boolean;
      tasks: Task[];
      isProjectStart?: boolean;
      isProjectEnd?: boolean;
    }> = [];

    // Previous month days
    const prevMonth = firstDayOfMonth.clone().subtract(1, 'jMonth');
    const prevMonthYear = prevMonth.jYear();
    const prevMonthMonth = prevMonth.jMonth();
    const prevMonthDays = moment.jDaysInMonth(prevMonthYear, prevMonthMonth);
    for (let i = adjustedFirstDay - 1; i >= 0; i--) {
      const jalaliDay = prevMonthDays - i;
      const date = prevMonth.clone().jDate(jalaliDay);
      const dateKey = date.format('jYYYY/jMM/jDD');
      const isStart = startDate && dateKey === moment(startDate).format('jYYYY/jMM/jDD');
      const isEnd = endDate && dateKey === moment(endDate).format('jYYYY/jMM/jDD');
      days.push({
        date,
        day: jalaliDay, // Use Jalali date number directly
        isCurrentMonth: false,
        tasks: eventsByDate[dateKey] || [],
        isProjectStart: !!isStart,
        isProjectEnd: !!isEnd,
      });
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
      const date = firstDayOfMonth.clone().jDate(day);
      const dateKey = date.format('jYYYY/jMM/jDD');
      const isStart = startDate && dateKey === moment(startDate).format('jYYYY/jMM/jDD');
      const isEnd = endDate && dateKey === moment(endDate).format('jYYYY/jMM/jDD');
      days.push({
        date,
        day: day, // Use Jalali date number directly
        isCurrentMonth: true,
        tasks: eventsByDate[dateKey] || [],
        isProjectStart: !!isStart,
        isProjectEnd: !!isEnd,
      });
    }

    // Next month days to fill the grid
    const totalCells = Math.ceil((days.length) / 7) * 7;
    const remainingDays = totalCells - days.length;
    const nextMonth = firstDayOfMonth.clone().add(1, 'jMonth');
    for (let day = 1; day <= remainingDays; day++) {
      const date = nextMonth.clone().jDate(day);
      const dateKey = date.format('jYYYY/jMM/jDD');
      const isStart = startDate && dateKey === moment(startDate).format('jYYYY/jMM/jDD');
      const isEnd = endDate && dateKey === moment(endDate).format('jYYYY/jMM/jDD');
      days.push({
        date,
        day: day, // Use Jalali date number directly
        isCurrentMonth: false,
        tasks: eventsByDate[dateKey] || [],
        isProjectStart: !!isStart,
        isProjectEnd: !!isEnd,
      });
    }

    return days;
  }, [currentYear, currentMonth, eventsByDate, projectStartDate, projectEndDate]);

  const goToPreviousMonth = () => {
    setCurrentDate(currentDate.clone().subtract(1, 'jMonth'));
  };

  const goToNextMonth = () => {
    setCurrentDate(currentDate.clone().add(1, 'jMonth'));
  };

  const goToToday = () => {
    setCurrentDate(moment());
  };

  const isToday = (date: moment.Moment) => {
    const today = moment().startOf('day');
    const checkDate = date.clone().startOf('day');
    return checkDate.format('jYYYY/jMM/jDD') === today.format('jYYYY/jMM/jDD');
  };

  return (
    <Card className="animate-fade-in-up">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            تقویم وظایف پروژه
            <span className="text-xs text-muted-foreground">
              ({tasksWithDates.length} وظیفه با تاریخ)
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={goToPreviousMonth}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={goToToday}
            >
              امروز
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={goToNextMonth}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="text-2xl font-bold text-center mt-4">
          {jalaliMonths[currentMonth]} {currentYear}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1 mb-2">
          {jalaliWeekDays.map((day) => (
            <div
              key={day}
              className="text-center font-semibold text-sm text-muted-foreground p-2"
            >
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((dayData, index) => {
            const hasEvents = dayData.tasks.length > 0 || dayData.isProjectStart || dayData.isProjectEnd;
            const isTodayDate = isToday(dayData.date);

            return (
              <div
                key={index}
                className={`min-h-[100px] border rounded-lg p-1 text-sm ${
                  !dayData.isCurrentMonth
                    ? 'bg-muted/30 text-muted-foreground'
                    : 'bg-background'
                } ${
                  isTodayDate
                    ? 'ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-950'
                    : ''
                } hover:bg-muted/50 transition-colors`}
              >
                <div
                  className={`font-semibold mb-1 ${
                    isTodayDate ? 'text-blue-600 dark:text-blue-400' : ''
                  }`}
                >
                  {dayData.day}
                </div>
                <div className="space-y-1">
                  {dayData.isProjectStart && (
                    <Badge
                      variant="outline"
                      className="text-xs w-full justify-start bg-green-100 text-green-700 border-green-200"
                    >
                      شروع پروژه
                    </Badge>
                  )}
                  {dayData.isProjectEnd && (
                    <Badge
                      variant="outline"
                      className="text-xs w-full justify-start bg-purple-100 text-purple-700 border-purple-200"
                    >
                      پایان پروژه
                    </Badge>
                  )}
                  {dayData.tasks.slice(0, 2).map((task) => (
                    <Popover key={task.id}>
                      <PopoverTrigger asChild>
                        <div className="cursor-pointer">
                          <Badge
                            variant="outline"
                            className={`text-xs w-full justify-start ${priorityColors[task.priority] || 'bg-gray-100 text-gray-700'}`}
                          >
                            <span className="truncate">{task.title}</span>
                          </Badge>
                        </div>
                      </PopoverTrigger>
                      <PopoverContent className="w-80">
                        <div className="space-y-2">
                          <div>
                            <h4 className="font-semibold">{task.title}</h4>
                            <p className="text-sm text-muted-foreground">
                              مهلت: {task.dueDate ? formatJalaliDate(task.dueDate) : '-'}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Badge variant="outline" className={statusColors[task.status]}>
                              {statusLabels[task.status]}
                            </Badge>
                            <Badge variant="outline" className={priorityColors[task.priority]}>
                              {priorityLabels[task.priority]}
                            </Badge>
                          </div>
                          {task.assignedTo && (
                            <p className="text-sm">
                              محول شده به: {task.assignedTo.name}
                            </p>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  ))}
                  {dayData.tasks.length > 2 && (
                    <div className="text-xs text-muted-foreground">
                      +{dayData.tasks.length - 2} وظیفه دیگر
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

