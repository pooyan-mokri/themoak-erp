'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { formatJalaliDate } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import type { ProjectFigures } from '@/actions/project';
import { PILL, PROJECT_STATUSES, fa, projectStatus } from './project-labels';

interface ProjectListProps {
  projects: any[];
  /** Tasks, done, overdue and (finance.view) spent, per project id. */
  figures?: Record<string, ProjectFigures>;
  /** The budget is finance data (finance.view). */
  showBudget?: boolean;
}

/** The projects as cards: status, dates, task progress and, for finance.view, budget and what was spent. */
export function ProjectList({ projects, figures = {}, showBudget = false }: ProjectListProps) {
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');

  const chips = [
    { id: 'all', label: 'همه', count: projects.length },
    ...PROJECT_STATUSES.map((s) => ({ id: s.id, label: s.label, count: projects.filter((p) => p.status === s.id).length })),
  ];

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter(
      (p) =>
        (status === 'all' || p.status === status) &&
        (!q || p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q)),
    );
  }, [projects, status, query]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => setStatus(chip.id)}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors duration-150',
              status === chip.id ? 'border-foreground bg-foreground text-white' : 'bg-card hover:border-foreground/40',
            )}
          >
            {chip.label}
            <span className="font-mono text-[11px] opacity-70">{fa(chip.count)}</span>
          </button>
        ))}
        <div className="flex-1" />
        <div className="relative w-full sm:w-60">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="نام یا توضیحات پروژه" className="ps-8" />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border bg-card px-4 py-10 text-center text-[13px] text-muted-foreground">
          {projects.length === 0 ? (
            'هنوز پروژه‌ای ثبت نشده است. با «پروژه جدید» یک پروژه بسازید و وظایفش را روی تابلو بچینید.'
          ) : (
            <>
              پروژه‌ای با این وضعیت و جستجو پیدا نشد.{' '}
              <button
                className="text-brand hover:underline"
                onClick={() => {
                  setStatus('all');
                  setQuery('');
                }}
              >
                نمایش همه
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((project) => {
            const s = projectStatus(project.status);
            const f = figures[project.id];
            const total = f?.tasks ?? project._count?.tasks ?? 0;
            const done = f?.done ?? 0;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const budget = Number(project.budget || 0);
            const spent = f?.spent;
            const over = spent !== undefined && budget > 0 && spent > budget;
            return (
              <div key={project.id} className="flex flex-col gap-3 rounded-lg border bg-card p-4 transition-colors duration-150 hover:border-input">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/dashboard/projects/${project.id}`} className="block truncate text-[15px] font-medium hover:text-brand">
                      {project.name}
                    </Link>
                    <p className="mt-0.5 line-clamp-1 text-[12.5px] text-muted-foreground">{project.description || 'بدون توضیحات'}</p>
                  </div>
                  <span className={cn(PILL, s.tone)}>{s.label}</span>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {project.startDate ? formatJalaliDate(project.startDate) : 'بدون تاریخ شروع'}
                    {project.endDate && ` تا ${formatJalaliDate(project.endDate)}`}
                  </span>
                  {f && f.overdue > 0 && <span className={cn(PILL, 'bg-danger-soft text-danger')}>{fa(f.overdue)} وظیفه دیرکرد</span>}
                </div>

                <div>
                  <div className="mb-1 flex justify-between text-[12px]">
                    <span className="text-muted-foreground">
                      {total > 0 ? `${fa(done)} از ${fa(total)} وظیفه انجام شده` : 'هنوز وظیفه‌ای ندارد'}
                    </span>
                    {total > 0 && <span className="font-medium tabular-nums">{fa(pct)}٪</span>}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div className={cn('h-full', project.status === 'COMPLETED' ? 'bg-success' : 'bg-brand')} style={{ width: `${pct}%` }} />
                  </div>
                </div>

                {showBudget && (
                  <div className="mt-auto grid grid-cols-2 gap-3 border-t pt-3">
                    <div>
                      <p className="text-[11.5px] text-muted-foreground">بودجه (تومان)</p>
                      <p className="mt-0.5 text-[13.5px] font-medium tabular-nums">{budget ? fa(budget) : '—'}</p>
                    </div>
                    {spent !== undefined && (
                      <div>
                        <p className="text-[11.5px] text-muted-foreground">
                          هزینه شده{budget > 0 && ` · ${fa((spent / budget) * 100)}٪`}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[13.5px] font-medium tabular-nums">
                          {spent ? fa(spent) : '—'}
                          {over && <span className={cn(PILL, 'bg-warning-soft text-warning')}>بیش از بودجه</span>}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
