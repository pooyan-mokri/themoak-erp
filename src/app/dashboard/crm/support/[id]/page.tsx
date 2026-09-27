import { getTicketById } from '@/actions/crm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TicketActions } from '@/components/crm/ticket-actions';
import { PageHeader } from '@/components/layout/page-header';
import { BackButton } from '@/components/ui/back-button';
import { PILL, ticketPriority, ticketStatus } from '@/components/crm/crm-labels';
import { formatJalaliDate } from '@/lib/date-utils';
import { hasPermission, requireRouteAccess } from '@/lib/access';
import { cn } from '@/lib/utils';

export default async function TicketDetailsPage({ params }: { params: { id: string } }) {
  await requireRouteAccess('/dashboard/crm');
  const [ticket, canManage] = await Promise.all([getTicketById(params.id), hasPermission('sales.manage')]);

  if (!ticket) {
    notFound();
  }

  const status = ticketStatus(ticket.status);
  const priority = ticketPriority(ticket.priority);

  return (
    <div className="space-y-4">
      <BackButton href="/dashboard/crm/support" label="بازگشت به تیکت‌ها" />
      <PageHeader
        title={`تیکت #${ticket.ticketNumber}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className={cn(PILL, status.tone)}>{status.label}</span>
            <span className={cn(PILL, priority.tone)}>اولویت {priority.label}</span>
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="space-y-4 rounded-lg border bg-card p-4 md:col-span-2">
          <h3 className="text-[15px] font-medium">{ticket.subject}</h3>
          <div>
            <h4 className="mb-1 text-xs text-muted-foreground">شرح مشکل</h4>
            <p className="whitespace-pre-wrap text-[13.5px]">{ticket.description}</p>
          </div>

          {ticket.resolution && (
            <div className="rounded-md bg-success-soft p-3">
              <h4 className="mb-1 text-xs text-success">پاسخ</h4>
              <p className="whitespace-pre-wrap text-[13.5px]">{ticket.resolution}</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-4">
            <h3 className="mb-3 text-sm font-medium">جزئیات</h3>
            <dl className="space-y-2 text-[13px]">
              {ticket.customer && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">مشتری</dt>
                  <dd>
                    <Link href={`/dashboard/crm/customers/${ticket.customer.id}`} className="font-medium text-brand hover:underline">
                      {ticket.customer.name}
                    </Link>
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">تاریخ ایجاد</dt>
                <dd className="font-mono text-[12.5px]">{formatJalaliDate(ticket.createdAt)}</dd>
              </div>
            </dl>
          </div>

          {canManage && (
            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-3 text-sm font-medium">عملیات</h3>
              <TicketActions ticketId={ticket.id} currentStatus={ticket.status} hasResolution={!!ticket.resolution} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
