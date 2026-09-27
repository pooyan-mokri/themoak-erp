'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { formatJalaliDate } from '@/lib/date-utils';
import { PILL, fa, leadStatus } from './crm-labels';

interface Lead {
  id: string;
  name: string;
  status: string;
  score: number;
  expectedValue: any;
  createdAt: Date;
}

interface CustomerLeadsTabProps {
  leads: Lead[];
}

export function CustomerLeadsTab({ leads }: CustomerLeadsTabProps) {
  if (leads.length === 0) {
    return (
      <div className="rounded-lg border bg-card py-8 text-center text-[13px] text-muted-foreground">
        هیچ سرنخی به این مشتری وصل نیست.
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-lg border bg-card">
      {leads.map((lead) => {
        const status = leadStatus(lead.status);
        return (
          <li key={lead.id} className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-brand/[.04]">
            <div className="min-w-0 flex-1">
              <Link href={`/dashboard/crm/leads/${lead.id}`} className="font-medium hover:text-brand hover:underline">
                {lead.name}
              </Link>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                امتیاز: {fa(lead.score)}/۱۰۰
                {lead.expectedValue && ` · ارزش: ${fa(Number(lead.expectedValue))} تومان`}
                {` · ${formatJalaliDate(lead.createdAt)}`}
              </p>
            </div>
            <span className={cn(PILL, status.tone)}>{status.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
