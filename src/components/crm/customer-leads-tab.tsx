'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Eye } from 'lucide-react';
import Link from 'next/link';

import { formatJalaliDate } from '@/lib/date-utils';
interface Lead {
  id: string;
  name: string;
  status: string;
  score: number;
  expectedValue: any;
  createdAt: Date;
}

interface CustomerLeadsTabProps {
  leads: Lead[];
}

export function CustomerLeadsTab({ leads }: CustomerLeadsTabProps) {
  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      NEW: 'جدید',
      CONTACTED: 'تماس گرفته شده',
      QUALIFIED: 'واجد شرایط',
      LOST: 'از دست رفته',
    };
    return labels[status] || status;
  };

  if (leads.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground border rounded-md">
        هیچ سرنخی برای این مشتری یافت نشد.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {leads.map((lead) => (
        <Card key={lead.id}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-medium">{lead.name}</h4>
                  <Badge variant="outline">{getStatusLabel(lead.status)}</Badge>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>امتیاز: {lead.score}/100</span>
                  {lead.expectedValue && (
                    <span>ارزش: {new Intl.NumberFormat('fa-IR').format(Number(lead.expectedValue))} تومان</span>
                  )}
                  <span>{formatJalaliDate(lead.createdAt)}</span>
                </div>
              </div>
              <Link href={`/dashboard/crm/leads/${lead.id}`}>
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
