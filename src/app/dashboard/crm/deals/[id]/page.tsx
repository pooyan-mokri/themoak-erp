import { getDealById } from '@/actions/crm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { BackButton } from '@/components/ui/back-button';
import { PILL, dealStage, fa } from '@/components/crm/crm-labels';
import { formatJalaliDate } from '@/lib/date-utils';
import { requireRouteAccess } from '@/lib/access';
import { cn } from '@/lib/utils';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end">{children}</dd>
    </div>
  );
}

export default async function DealDetailsPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  await requireRouteAccess('/dashboard/crm');
  const params = await paramsPromise;
  const deal = await getDealById(params.id);

  if (!deal) {
    notFound();
  }

  const stage = dealStage(deal.stage);

  return (
    <div className="space-y-4">
      <BackButton href="/dashboard/crm/deals" label="بازگشت به فرصت‌های فروش" />
      <PageHeader title={deal.title} description={<span className={cn(PILL, stage.tone)}>{stage.label}</span>} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">اطلاعات معامله</h3>
          <dl className="space-y-2 text-[13px]">
            {deal.customer && (
              <Row label="مشتری">
                <Link href={`/dashboard/crm/customers/${deal.customer.id}`} className="font-medium text-brand hover:underline">
                  {deal.customer.name}
                </Link>
              </Row>
            )}
            <Row label="ارزش">
              <span className="font-medium tabular-nums">{fa(Number(deal.value))} تومان</span>
            </Row>
            <Row label="احتمال برد">{fa(deal.probability)}٪</Row>
            {deal.expectedClose && <Row label="تاریخ پیش‌بینی شده">{formatJalaliDate(deal.expectedClose)}</Row>}
            {deal.lostReason && <Row label="دلیل باخت">{deal.lostReason}</Row>}
          </dl>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">تاریخچه</h3>
          <dl className="space-y-2 text-[13px]">
            <Row label="تاریخ ایجاد">{formatJalaliDate(deal.createdAt)}</Row>
            {deal.actualClose && <Row label="تاریخ بسته شدن">{formatJalaliDate(deal.actualClose)}</Row>}
          </dl>
        </div>

        {deal.notes && (
          <div className="rounded-lg border bg-card p-4 md:col-span-2">
            <h3 className="mb-2 text-sm font-medium">یادداشت‌ها</h3>
            <p className="whitespace-pre-wrap text-[13.5px]">{deal.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
