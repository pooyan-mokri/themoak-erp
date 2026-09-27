'use client';

import { useState } from 'react';
import { formatJalaliDate } from '@/lib/date-utils';
import { cn } from '@/lib/utils';
import { CAMPAIGN_STATUSES, campaignStatus, channelOf, fa } from './marketing-labels';

interface Campaign {
  id: string;
  name: string;
  description?: string;
  type: string;
  startDate: Date;
  endDate?: Date;
  budget?: number;
  /** Null without cost.view: the spend adds up gift costs. */
  spentAmount: number | null;
  status: string;
  _count: {
    gifts: number;
  };
}

interface CampaignListProps {
  campaigns: Campaign[];
  /** Hide the status chips (a short list on the overview). */
  compact?: boolean;
}

/** Each campaign as a row: its channel, dates, gifts, budget and spend, and its status. */
export function CampaignList({ campaigns, compact = false }: CampaignListProps) {
  const [status, setStatus] = useState('all');
  const chips = [
    { id: 'all', label: 'همه', count: campaigns.length },
    ...CAMPAIGN_STATUSES.map((s) => ({ id: s.id, label: s.label, count: campaigns.filter((c) => c.status === s.id).length })),
  ];
  const rows = status === 'all' ? campaigns : campaigns.filter((c) => c.status === status);

  return (
    <div className="space-y-3">
      {!compact && (
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
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg border bg-card px-4 py-10 text-center text-[13px] text-muted-foreground">
          {campaigns.length === 0
            ? 'هیچ کمپین بازاریابی ثبت نشده است. کمپین را بسازید تا هدایا را به آن وصل کنید و هزینه‌اش را ببینید.'
            : 'کمپینی با این وضعیت نیست.'}
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((campaign) => {
            const s = campaignStatus(campaign.status);
            const channel = channelOf(campaign.type);
            const budgetPercent =
              campaign.budget && campaign.budget > 0 ? ((campaign.spentAmount ?? 0) / campaign.budget) * 100 : 0;
            return (
              <li key={campaign.id} className="rounded-lg border bg-card p-4">
                <div className="flex items-start gap-3">
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand font-mono text-[10px] text-white"
                    title={channel.label}
                  >
                    {channel.code}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="truncate text-sm font-medium">{campaign.name}</h3>
                      <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px]', s.tone)}>{s.label}</span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {channel.label} · از {formatJalaliDate(campaign.startDate)}
                      {campaign.endDate && ` تا ${formatJalaliDate(campaign.endDate)}`} · {fa(campaign._count.gifts)} هدیه
                    </p>
                    {campaign.description && <p className="mt-1 line-clamp-2 text-[12.5px]">{campaign.description}</p>}
                  </div>
                </div>

                {campaign.budget && (
                  <div className="mt-3 space-y-1 border-t pt-3">
                    <div className="flex justify-between text-[12.5px]">
                      <span className="text-muted-foreground">بودجه</span>
                      <span className="tabular-nums">
                        {campaign.spentAmount !== null && <>{fa(campaign.spentAmount)} از </>}
                        {fa(campaign.budget)} تومان
                      </span>
                    </div>
                    {campaign.spentAmount !== null && (
                      <>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                          <div
                            className={cn('h-full', budgetPercent > 100 ? 'bg-warning' : 'bg-brand')}
                            style={{ width: `${Math.min(budgetPercent, 100)}%` }}
                          />
                        </div>
                        <div className="text-end text-[11.5px] text-muted-foreground">
                          {new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(budgetPercent)}٪ استفاده شده
                        </div>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
