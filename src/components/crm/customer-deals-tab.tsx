'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Eye } from 'lucide-react';
import Link from 'next/link';

import { formatJalaliDate } from '@/lib/date-utils';
interface Deal {
  id: string;
  title: string;
  stage: string;
  value: any;
  probability: number;
  expectedClose: Date | null;
}

interface CustomerDealsTabProps {
  deals: Deal[];
}

export function CustomerDealsTab({ deals }: CustomerDealsTabProps) {
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

  const getStageColor = (stage: string) => {
    switch (stage) {
      case 'WON': return 'default';
      case 'LOST': return 'destructive';
      default: return 'secondary';
    }
  };

  if (deals.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground border rounded-md">
        هیچ فرصت فروشی برای این مشتری یافت نشد.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {deals.map((deal) => (
        <Card key={deal.id}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-medium">{deal.title}</h4>
                  <Badge variant={getStageColor(deal.stage)}>{getStageLabel(deal.stage)}</Badge>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="text-green-600 font-medium">
                    {new Intl.NumberFormat('fa-IR').format(Number(deal.value))} تومان
                  </span>
                  <span>احتمال: {deal.probability}%</span>
                  {deal.expectedClose && (
                    <span>موعد: {formatJalaliDate(deal.expectedClose)}</span>
                  )}
                </div>
              </div>
              <Link href={`/dashboard/crm/deals/${deal.id}`}>
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
