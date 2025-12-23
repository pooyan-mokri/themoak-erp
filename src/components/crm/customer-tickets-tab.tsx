'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Eye } from 'lucide-react';
import Link from 'next/link';

import { formatJalaliDate } from '@/lib/date-utils';
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

  if (tickets.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground border rounded-md">
        هیچ تیکت پشتیبانی برای این مشتری یافت نشد.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tickets.map((ticket) => (
        <Card key={ticket.id}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-sm text-muted-foreground">#{ticket.ticketNumber}</span>
                  <h4 className="font-medium">{ticket.subject}</h4>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant={getPriorityColor(ticket.priority)}>
                    {getPriorityLabel(ticket.priority)}
                  </Badge>
                  <Badge variant="outline">{getStatusLabel(ticket.status)}</Badge>
                  <span className="text-muted-foreground">
                    {formatJalaliDate(ticket.createdAt)}
                  </span>
                </div>
              </div>
              <Link href={`/dashboard/crm/support/${ticket.id}`}>
                <Button variant="ghost" size="icon">
                  <Eye className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
