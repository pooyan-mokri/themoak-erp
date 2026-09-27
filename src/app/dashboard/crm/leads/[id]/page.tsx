import { getLeadById } from '@/actions/crm';
import { Button } from '@/components/ui/button';
import { UserPlus } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { BackButton } from '@/components/ui/back-button';
import { PILL, fa, leadStatus } from '@/components/crm/crm-labels';
import { formatJalaliDate } from '@/lib/date-utils';
import { hasPermission, requireRouteAccess } from '@/lib/access';
import { cn } from '@/lib/utils';

function Row({ label, children, ltr }: { label: string; children: React.ReactNode; ltr?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('text-end', ltr && 'font-mono text-[12.5px]')} dir={ltr ? 'ltr' : undefined}>
        {children}
      </dd>
    </div>
  );
}

export default async function LeadDetailsPage({ params }: { params: { id: string } }) {
  await requireRouteAccess('/dashboard/crm');
  const [lead, canManage] = await Promise.all([getLeadById(params.id), hasPermission('sales.manage')]);

  if (!lead) {
    notFound();
  }

  const status = leadStatus(lead.status);

  return (
    <div className="space-y-4">
      <BackButton href="/dashboard/crm/leads" label="بازگشت به سرنخ‌ها" />
      <PageHeader
        title={lead.name}
        description={<span className={cn(PILL, status.tone)}>{status.label}</span>}
        actions={
          canManage &&
          !lead.customerId &&
          lead.status === 'QUALIFIED' && (
            <Button asChild>
              <Link href={`/dashboard/crm/customers/new?leadId=${lead.id}`}>
                <UserPlus className="h-4 w-4" />
                تبدیل به مشتری
              </Link>
            </Button>
          )
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">اطلاعات سرنخ</h3>
          <dl className="space-y-2 text-[13px]">
            <Row label="نام">{lead.name}</Row>
            {lead.company && <Row label="شرکت">{lead.company}</Row>}
            {lead.phone && <Row label="تلفن" ltr>{lead.phone}</Row>}
            {lead.email && <Row label="ایمیل" ltr>{lead.email}</Row>}
            {lead.source && <Row label="منبع">{lead.source}</Row>}
          </dl>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">اطلاعات ارزیابی</h3>
          <dl className="space-y-2 text-[13px]">
            <Row label="امتیاز">{fa(lead.score)}/۱۰۰</Row>
            {lead.expectedValue && <Row label="ارزش مورد انتظار">{fa(Number(lead.expectedValue))} تومان</Row>}
            <Row label="تاریخ ایجاد">{formatJalaliDate(lead.createdAt)}</Row>
            {lead.customer && (
              <Row label="مشتری">
                <Link href={`/dashboard/crm/customers/${lead.customer.id}`} className="text-brand hover:underline">
                  {lead.customer.name}
                </Link>
              </Row>
            )}
          </dl>
        </div>

        {lead.notes && (
          <div className="rounded-lg border bg-card p-4 md:col-span-2">
            <h3 className="mb-2 text-sm font-medium">یادداشت‌ها</h3>
            <p className="whitespace-pre-wrap text-[13.5px]">{lead.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
