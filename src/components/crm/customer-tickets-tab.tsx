'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { formatJalaliDate } from '@/lib/date-utils';
import { PILL, ticketPriority, ticketStatus } from './crm-labels';

interface Ticket {
  id: string;
  ticketNumber: number;
  subject: string;
  priority: string;
  status: string;
  createdAt: Date;
}

interface CustomerTicketsTabProps {
  tickets: Ticket[];
}

export function CustomerTicketsTab({ tickets }: CustomerTicketsTabProps) {
  if (tickets.length === 0) {
    return (
      <div className="rounded-lg border bg-card py-8 text-center text-[13px] text-muted-foreground">
        هیچ تیکت پشتیبانی برای این مشتری ثبت نشده است.
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-lg border bg-card">
      {tickets.map((ticket) => {
        const priority = ticketPriority(ticket.priority);
        const status = ticketStatus(ticket.status);
        return (
          <li key={ticket.id} className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-brand/[.04]">
            <span className="font-mono text-[12px] text-muted-foreground">#{ticket.ticketNumber}</span>
            <div className="min-w-0 flex-1">
              <Link href={`/dashboard/crm/support/${ticket.id}`} className="font-medium hover:text-brand hover:underline">
                {ticket.subject}
              </Link>
              <p className="mt-0.5 font-mono text-[12px] text-muted-foreground">{formatJalaliDate(ticket.createdAt)}</p>
            </div>
            <span className={cn(PILL, priority.tone)}>{priority.label}</span>
            <span className={cn(PILL, status.tone)}>{status.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
