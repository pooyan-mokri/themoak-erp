'use client';

import { useState } from 'react';
import { LayoutGrid, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

type ViewType = 'board' | 'calendar';

interface ViewToggleProps {
  defaultView?: ViewType;
  boardView: React.ReactNode;
  calendarView: React.ReactNode;
}

export function ViewToggle({ defaultView = 'board', boardView, calendarView }: ViewToggleProps) {
  const [view, setView] = useState<ViewType>(defaultView);
  const options = [
    { id: 'board' as const, label: 'تابلوی وظایف', icon: LayoutGrid },
    { id: 'calendar' as const, label: 'تقویم', icon: Calendar },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <div className="inline-flex rounded-md border bg-secondary p-0.5">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setView(option.id)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded px-3 text-[12.5px] transition-colors duration-150',
                view === option.id ? 'bg-card font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <option.icon className="h-4 w-4" />
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {view === 'board' ? boardView : calendarView}
    </div>
  );
}
