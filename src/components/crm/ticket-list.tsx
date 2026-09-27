'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Eye } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { formatJalaliDate } from '@/lib/date-utils';
import { PILL, ticketPriority, ticketStatus } from './crm-labels';

interface Ticket {
  id: string;
  ticketNumber: number;
  subject: string;
  customer?: {
    name: string;
  };
  priority: string;
  status: string;
  createdAt: Date;
}

interface TicketListProps {
  tickets: Ticket[];
}

export function TicketList({ tickets }: TicketListProps) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[80px]">#</TableHead>
            <TableHead>موضوع</TableHead>
            <TableHead>مشتری</TableHead>
            <TableHead>اولویت</TableHead>
            <TableHead>وضعیت</TableHead>
            <TableHead>تاریخ ایجاد</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {tickets.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                هیچ تیکتی ثبت نشده است. درخواست یا شکایت هر مشتری را با «تیکت جدید» ثبت کنید تا پیگیری شود.
              </TableCell>
            </TableRow>
          ) : (
            tickets.map((ticket) => {
              const priority = ticketPriority(ticket.priority);
              const status = ticketStatus(ticket.status);
              return (
                <TableRow key={ticket.id}>
                  <TableCell className="font-mono text-[12.5px]">#{ticket.ticketNumber}</TableCell>
                  <TableCell>
                    <Link href={`/dashboard/crm/support/${ticket.id}`} className="font-medium hover:text-brand hover:underline">
                      {ticket.subject}
                    </Link>
                  </TableCell>
                  <TableCell>{ticket.customer?.name || '—'}</TableCell>
                  <TableCell>
                    <span className={cn(PILL, priority.tone)}>{priority.label}</span>
                  </TableCell>
                  <TableCell>
                    <span className={cn(PILL, status.tone)}>{status.label}</span>
                  </TableCell>
                  <TableCell className="font-mono text-[12px] text-muted-foreground">{formatJalaliDate(ticket.createdAt)}</TableCell>
                  <TableCell className="text-end">
                    <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="جزئیات تیکت">
                      <Link href={`/dashboard/crm/support/${ticket.id}`}>
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
