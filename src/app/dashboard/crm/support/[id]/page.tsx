import { getTicketById } from '@/actions/crm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TicketActions } from '@/components/crm/ticket-actions';

import { formatJalaliDate } from '@/lib/date-utils';

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

export default async function TicketDetailsPage({ params }: { params: { id: string } }) {
  const ticket = await getTicketById(params.id);

  if (!ticket) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/dashboard/crm/support">
          <Button variant="ghost" size="icon">
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">تیکت #{ticket.ticketNumber}</h1>
        <Badge>{getStatusLabel(ticket.status)}</Badge>
        <Badge variant={getPriorityColor(ticket.priority)}>
          {getPriorityLabel(ticket.priority)}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>{ticket.subject}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-medium mb-2">شرح مشکل:</h4>
              <p className="text-sm whitespace-pre-wrap">{ticket.description}</p>
            </div>
            
            {ticket.resolution && (
              <div className="p-4 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-900">
                <h4 className="font-medium mb-2 text-green-900 dark:text-green-100">✓ پاسخ:</h4>
                <p className="text-sm whitespace-pre-wrap text-green-800 dark:text-green-200">
                  {ticket.resolution}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>جزئیات</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">مشتری:</span>
                <Link href={`/dashboard/crm/customers/${ticket.customer.id}`} className="font-medium text-blue-600 hover:underline">
                  {ticket.customer.name}
                </Link>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">تاریخ ایجاد:</span>
                <span className="font-medium">
                  {formatJalaliDate(ticket.createdAt)}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>عملیات</CardTitle>
            </CardHeader>
            <CardContent>
              <TicketActions 
                ticketId={ticket.id} 
                currentStatus={ticket.status}
                hasResolution={!!ticket.resolution}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
