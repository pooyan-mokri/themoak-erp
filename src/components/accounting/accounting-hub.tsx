'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HUB_GROUPS, HUB_TILES, type HubGroup } from './hub-tiles';

const fa = (n: number) => n.toLocaleString('fa-IR');

/** The hub's sections the role may open, with a chip row to narrow them by kind. */
export function AccountingHubTiles({ visible }: { visible: string[] }) {
  const tiles = HUB_TILES.filter((tile) => visible.includes(tile.href));
  const [group, setGroup] = useState<HubGroup | 'all'>('all');
  const chips = [
    { id: 'all' as const, label: 'همه', count: tiles.length },
    ...HUB_GROUPS.map((g) => ({ ...g, count: tiles.filter((tile) => tile.group === g.id).length })).filter((g) => g.count > 0),
  ];
  const shown = group === 'all' ? tiles : tiles.filter((tile) => tile.group === group);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            aria-pressed={group === chip.id}
            onClick={() => setGroup(chip.id)}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors duration-150',
              group === chip.id ? 'border-foreground bg-foreground text-white' : 'bg-card hover:border-foreground/40',
            )}
          >
            {chip.label}
            <span className="font-mono text-[11px] opacity-70">{fa(chip.count)}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="group relative flex min-h-[124px] flex-col gap-2 rounded-lg border bg-card p-4 transition-colors duration-150 hover:border-brand"
          >
            <span
              className={cn(
                'grid h-9 w-9 place-items-center rounded-md',
                tile.group === 'entry' ? 'bg-brand-soft text-brand' : 'border bg-secondary text-muted-foreground',
              )}
            >
              <tile.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </span>
            <span className="text-[11px] text-muted-foreground">{tile.eyebrow}</span>
            <span className="text-sm font-medium">{tile.title}</span>
            <span className="text-[11.5px] leading-relaxed text-muted-foreground">{tile.subtitle}</span>
            <ArrowLeft className="absolute end-4 top-4 h-3.5 w-3.5 text-brand opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
          </Link>
        ))}
      </div>
    </div>
  );
}
