'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { formatJalaliDate } from '@/lib/date-utils';
import { PILL, dealStage, fa } from './crm-labels';

interface Deal {
  id: string;
  title: string;
  stage: string;
  value: any;
  probability: number;
  expectedClose?: Date;
}

interface CustomerDealsTabProps {
  deals: Deal[];
}

export function CustomerDealsTab({ deals }: CustomerDealsTabProps) {
  if (deals.length === 0) {
    return (
      <div className="rounded-lg border bg-card py-8 text-center text-[13px] text-muted-foreground">
        هیچ فرصت فروشی برای این مشتری ثبت نشده است.
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-lg border bg-card">
      {deals.map((deal) => {
        const stage = dealStage(deal.stage);
        return (
          <li key={deal.id} className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-brand/[.04]">
            <div className="min-w-0 flex-1">
              <Link href={`/dashboard/crm/deals/${deal.id}`} className="font-medium hover:text-brand hover:underline">
                {deal.title}
              </Link>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                احتمال: {fa(deal.probability)}٪
                {deal.expectedClose && ` · موعد: ${formatJalaliDate(deal.expectedClose)}`}
              </p>
            </div>
            <span className="text-[13.5px] font-medium tabular-nums">
              {fa(Number(deal.value))}
              <small className="ms-1 text-[11px] font-normal text-muted-foreground">تومان</small>
            </span>
            <span className={cn(PILL, stage.tone)}>{stage.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
