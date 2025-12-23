'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <div className="flex items-center gap-1 border rounded-lg p-1 bg-muted/50">
          <Button
            variant={view === 'board' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setView('board')}
            className={cn(
              'gap-2',
              view === 'board' && 'bg-background shadow-sm'
            )}
          >
            <LayoutGrid className="h-4 w-4" />
            نمای Board
          </Button>
          <Button
            variant={view === 'calendar' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setView('calendar')}
            className={cn(
              'gap-2',
              view === 'calendar' && 'bg-background shadow-sm'
            )}
          >
            <Calendar className="h-4 w-4" />
            نمای تقویم
          </Button>
        </div>
      </div>
      {view === 'board' ? boardView : calendarView}
    </div>
  );
}

