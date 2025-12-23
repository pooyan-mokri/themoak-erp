import { getLeadById, convertLeadToCustomer } from '@/actions/crm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowRight, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { formatJalaliDate } from '@/lib/date-utils';
export default async function LeadDetailsPage({ params }: { params: { id: string } }) {
  const lead = await getLeadById(params.id);

  if (!lead) {
    notFound();
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'NEW': return 'جدید';
      case 'CONTACTED': return 'تماس گرفته شده';
      case 'QUALIFIED': return 'واجد شرایط';
      case 'LOST': return 'از دست رفته';
      default: return status;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/dashboard/crm/leads">
            <Button variant="ghost" size="icon">
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">{lead.name}</h1>
          <Badge>{getStatusLabel(lead.status)}</Badge>
        </div>
        {!lead.customerId && lead.status === 'QUALIFIED' && (
          <Link href={`/dashboard/crm/customers/new?leadId=${lead.id}`}>
            <Button>
              <UserPlus className="h-4 w-4 m l-2" />
              تبدیل به مشتری
            </Button>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>اطلاعات سرنخ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">نام:</span>
              <span className="font-medium">{lead.name}</span>
            </div>
            {lead.company && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">شرکت:</span>
                <span className="font-medium">{lead.company}</span>
              </div>
            )}
            {lead.phone && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">تلفن:</span>
                <span className="font-medium" dir="ltr">{lead.phone}</span>
              </div>
            )}
            {lead.email && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">ایمیل:</span>
                <span className="font-medium">{lead.email}</span>
              </div>
            )}
            {lead.source && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">منبع:</span>
                <span className="font-medium">{lead.source}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>اطلاعات ارزیابی</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">امتیاز:</span>
              <span className="font-medium">{lead.score}/100</span>
            </div>
            {lead.expectedValue && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">ارزش مورد انتظار:</span>
                <span className="font-medium">
                  {new Intl.NumberFormat('fa-IR').format(Number(lead.expectedValue))} تومان
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">تاریخ ایجاد:</span>
              <span className="font-medium">
                {formatJalaliDate(lead.createdAt)}
              </span>
            </div>
          </CardContent>
        </Card>

        {lead.notes && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>یادداشت‌ها</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{lead.notes}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
