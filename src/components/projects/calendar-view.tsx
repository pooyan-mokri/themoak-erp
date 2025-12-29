'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, ChevronLeft, Calendar as CalendarIcon } from 'lucide-react';
import moment from 'moment-jalaali';
import { formatJalaliDate } from '@/lib/date-utils';
import Link from 'next/link';
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
  dueDate?: Date;
  assignedTo?: {
    id: string;
    name: string;
  };
  project: {
    id: string;
    name: string;
  };
}

interface Project {
  id: string;
  name: string;
  startDate?: Date;
  endDate?: Date;
  status: string;
  tasks: Task[];
}

interface CalendarViewProps {
  projects: Project[];
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

export function CalendarView({ projects }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(moment());

  const currentMonth = currentDate.jMonth();
  const currentYear = currentDate.jYear();

  // Get all tasks with due dates
  const tasksWithDates = useMemo(() => {
    const tasks: Task[] = [];
    projects.forEach((project) => {
      project.tasks.forEach((task) => {
        if (task.dueDate) {
          tasks.push({
            ...task,
            project: {
              id: project.id,
              name: project.name,
            },
          });
        }
      });
    });
    return tasks;
  }, [projects]);

  // Get all projects with start/end dates
  const projectsWithDates = useMemo(() => {
    return projects.filter(
      (p) => p.startDate || p.endDate
    );
  }, [projects]);

  // Group tasks and projects by date
  const eventsByDate = useMemo(() => {
    const events: Record<string, { tasks: Task[]; projects: Project[] }> = {};

    // Add tasks
    tasksWithDates.forEach((task) => {
      if (task.dueDate) {
        const dateKey = moment(task.dueDate).format('jYYYY/jMM/jDD');
        if (!events[dateKey]) {
          events[dateKey] = { tasks: [], projects: [] };
        }
        events[dateKey].tasks.push(task);
      }
    });

    // Add projects (start and end dates)
    projectsWithDates.forEach((project) => {
      if (project.startDate) {
        const startKey = moment(project.startDate).format('jYYYY/jMM/jDD');
        if (!events[startKey]) {
          events[startKey] = { tasks: [], projects: [] };
        }
        events[startKey].projects.push(project);
      }
      if (project.endDate) {
        const endKey = moment(project.endDate).format('jYYYY/jMM/jDD');
        if (!events[endKey]) {
          events[endKey] = { tasks: [], projects: [] };
        }
        events[endKey].projects.push(project);
      }
    });

    return events;
  }, [tasksWithDates, projectsWithDates]);

  // Generate calendar days
  const calendarDays = useMemo(() => {
    // Get first day of month and number of days
    const firstDayOfMonth = moment(`${currentYear}/${currentMonth + 1}/1`, 'jYYYY/jMM/jDD');
    const daysInMonth = moment.jDaysInMonth(currentYear, currentMonth);
    const firstDayWeekday = firstDayOfMonth.day(); // 0 = Saturday, 6 = Friday

    // Adjust for Jalali week (Saturday = 0)
    const adjustedFirstDay = firstDayWeekday === 6 ? 0 : firstDayWeekday + 1;

    const days: Array<{
      date: moment.Moment;
      day: number;
      isCurrentMonth: boolean;
      tasks: Task[];
      projects: Project[];
    }> = [];

    // Previous month days
    const prevMonth = firstDayOfMonth.clone().subtract(1, 'jMonth');
    const prevMonthYear = prevMonth.jYear();
    const prevMonthMonth = prevMonth.jMonth();
    const prevMonthDays = moment.jDaysInMonth(prevMonthYear, prevMonthMonth);
    for (let i = adjustedFirstDay - 1; i >= 0; i--) {
      const date = prevMonth.clone().date(prevMonthDays - i);
      const dateKey = date.format('jYYYY/jMM/jDD');
      days.push({
        date,
        day: prevMonthDays - i,
        isCurrentMonth: false,
        tasks: eventsByDate[dateKey]?.tasks || [],
        projects: eventsByDate[dateKey]?.projects || [],
      });
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
      const date = firstDayOfMonth.clone().date(day);
      const dateKey = date.format('jYYYY/jMM/jDD');
      days.push({
        date,
        day,
        isCurrentMonth: true,
        tasks: eventsByDate[dateKey]?.tasks || [],
        projects: eventsByDate[dateKey]?.projects || [],
      });
    }

    // Next month days to fill the grid
    const totalCells = Math.ceil((days.length) / 7) * 7;
    const remainingDays = totalCells - days.length;
    const nextMonth = firstDayOfMonth.clone().add(1, 'jMonth');
    for (let day = 1; day <= remainingDays; day++) {
      const date = nextMonth.clone().date(day);
      const dateKey = date.format('jYYYY/jMM/jDD');
      days.push({
        date,
        day,
        isCurrentMonth: false,
        tasks: eventsByDate[dateKey]?.tasks || [],
        projects: eventsByDate[dateKey]?.projects || [],
      });
    }

    return days;
  }, [currentYear, currentMonth, eventsByDate]);

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
    return date.format('jYYYY/jMM/jDD') === moment().format('jYYYY/jMM/jDD');
  };

  return (
    <Card className="animate-fade-in-up">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            تقویم پروژه‌ها و وظایف
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
            const hasEvents = dayData.tasks.length > 0 || dayData.projects.length > 0;
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
                              پروژه: {task.project.name}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Badge variant="outline" className={statusColors[task.status]}>
                              {task.status === 'TODO'
                                ? 'انجام نشده'
                                : task.status === 'IN_PROGRESS'
                                ? 'در حال انجام'
                                : task.status === 'REVIEW'
                                ? 'در حال بررسی'
                                : 'انجام شده'}
                            </Badge>
                            <Badge variant="outline" className={priorityColors[task.priority]}>
                              {task.priority === 'LOW'
                                ? 'کم'
                                : task.priority === 'MEDIUM'
                                ? 'متوسط'
                                : task.priority === 'HIGH'
                                ? 'زیاد'
                                : 'فوری'}
                            </Badge>
                          </div>
                          {task.assignedTo && (
                            <p className="text-sm">
                              محول شده به: {task.assignedTo.name}
                            </p>
                          )}
                          <Link
                            href={`/dashboard/projects/${task.project.id}`}
                            className="text-sm text-blue-600 hover:underline"
                          >
                            مشاهده پروژه →
                          </Link>
                        </div>
                      </PopoverContent>
                    </Popover>
                  ))}
                  {dayData.tasks.length > 2 && (
                    <div className="text-xs text-muted-foreground">
                      +{dayData.tasks.length - 2} وظیفه دیگر
                    </div>
                  )}
                  {dayData.projects.map((project) => (
                    <Popover key={project.id}>
                      <PopoverTrigger asChild>
                        <div className="cursor-pointer">
                          <Badge
                            variant="outline"
                            className={`text-xs w-full justify-start ${
                              project.startDate &&
                              dayData.date.format('jYYYY/jMM/jDD') ===
                                moment(project.startDate).format('jYYYY/jMM/jDD')
                                ? 'bg-green-100 text-green-700 border-green-200'
                                : 'bg-purple-100 text-purple-700 border-purple-200'
                            }`}
                          >
                            {project.startDate &&
                            dayData.date.format('jYYYY/jMM/jDD') ===
                              moment(project.startDate).format('jYYYY/jMM/jDD')
                              ? 'شروع: '
                              : 'پایان: '}
                            {project.name}
                          </Badge>
                        </div>
                      </PopoverTrigger>
                      <PopoverContent className="w-80">
                        <div className="space-y-2">
                          <div>
                            <h4 className="font-semibold">{project.name}</h4>
                            {project.startDate && (
                              <p className="text-sm text-muted-foreground">
                                شروع: {formatJalaliDate(project.startDate)}
                              </p>
                            )}
                            {project.endDate && (
                              <p className="text-sm text-muted-foreground">
                                پایان: {formatJalaliDate(project.endDate)}
                              </p>
                            )}
                          </div>
                          <Badge
                            variant="outline"
                            className={
                              project.status === 'ACTIVE'
                                ? 'bg-blue-100 text-blue-700'
                                : project.status === 'COMPLETED'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-700'
                            }
                          >
                            {project.status === 'ACTIVE'
                              ? 'فعال'
                              : project.status === 'COMPLETED'
                              ? 'تکمیل شده'
                              : project.status === 'ON_HOLD'
                              ? 'متوقف'
                              : 'لغو شده'}
                          </Badge>
                          <Link
                            href={`/dashboard/projects/${project.id}`}
                            className="text-sm text-blue-600 hover:underline block"
                          >
                            مشاهده پروژه →
                          </Link>
                        </div>
                      </PopoverContent>
                    </Popover>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

