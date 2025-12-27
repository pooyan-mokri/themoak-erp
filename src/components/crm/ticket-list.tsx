'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eye } from 'lucide-react';
import Link from 'next/link';

import { formatJalaliDate } from '@/lib/date-utils';
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
  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'URGENT': return 'destructive';
      case 'HIGH': return 'default';
      case 'MEDIUM': return 'secondary';
      case 'LOW': return 'outline';
      default: return 'outline';
    }
  };

  const getPriorityLabel = (priority: string) => {
    const labels: Record<string, string> = {
      URGENT: 'فوری',
      HIGH: 'بالا',
      MEDIUM: 'متوسط',
      LOW: 'پایین',
    };
    return labels[priority] || priority;
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      OPEN: 'باز',
      IN_PROGRESS: 'در حال بررسی',
      RESOLVED: 'حل شده',
      CLOSED: 'بسته',
    };
    return labels[status] || status;
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[80px]">#</TableHead>
            <TableHead>موضوع</TableHead>
            <TableHead>مشتری</TableHead>
            <TableHead>اولویت</TableHead>
            <TableHead>وضعیت</TableHead>
            <TableHead>تاریخ ایجاد</TableHead>
            <TableHead className="text-left">عملیات</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tickets.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                هیچ تیکتی یافت نشد.
              </TableCell>
            </TableRow>
          ) : (
            tickets.map((ticket) => (
              <TableRow key={ticket.id}>
                <TableCell className="font-medium">#{ticket.ticketNumber}</TableCell>
                <TableCell>{ticket.subject}</TableCell>
                <TableCell>{ticket.customer?.name || '-'}</TableCell>
                <TableCell>
                  <Badge variant={getPriorityColor(ticket.priority)}>
                    {getPriorityLabel(ticket.priority)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{getStatusLabel(ticket.status)}</Badge>
                </TableCell>
                <TableCell>{formatJalaliDate(ticket.createdAt)}</TableCell>
                <TableCell className="text-left">
                  <Link href={`/dashboard/crm/support/${ticket.id}`}>
                    <Button variant="ghost" size="icon">
                      <Eye className="h-4 w-4" />
                    </Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
