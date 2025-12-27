import { getDealById } from '@/actions/crm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { formatJalaliDate } from '@/lib/date-utils';
export default async function DealDetailsPage({ params }: { params: { id: string } }) {
  const deal = await getDealById(params.id);

  if (!deal) {
    notFound();
  }

  const getStageLabel = (stage: string) => {
    const labels: Record<string, string> = {
      PROSPECT: 'سرنخ',
      PROPOSAL: 'پیشنهاد',
      NEGOTIATION: 'مذاکره',
      WON: 'برنده',
      LOST: 'باخته',
    };
    return labels[stage] || stage;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/dashboard/crm/deals">
          <Button variant="ghost" size="icon">
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">{deal.title}</h1>
        <Badge>{getStageLabel(deal.stage)}</Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>اطلاعات معامله</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {deal.customer && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">مشتری:</span>
                <Link href={`/dashboard/crm/customers/${deal.customer.id}`} className="font-medium text-blue-600 hover:underline">
                  {deal.customer.name}
                </Link>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">ارزش:</span>
              <span className="font-medium text-green-600">
                {new Intl.NumberFormat('fa-IR').format(Number(deal.value))} تومان
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">احتمال برد:</span>
              <span className="font-medium">{deal.probability}%</span>
            </div>
            {deal.expectedClose && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">تاریخ پیش‌بینی شده:</span>
                <span className="font-medium">
                  {formatJalaliDate(deal.expectedClose)}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>تاریخچه</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">تاریخ ایجاد:</span>
              <span className="font-medium">
                {formatJalaliDate(deal.createdAt)}
              </span>
            </div>
            {deal.actualClose && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">تاریخ بسته شدن:</span>
                <span className="font-medium">
                  {formatJalaliDate(deal.actualClose)}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {deal.notes && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>یادداشت‌ها</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{deal.notes}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
