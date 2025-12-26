'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatJalaliDate } from '@/lib/date-utils';
import { Progress } from '@/components/ui/progress';

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  type: string;
  startDate: Date;
  endDate: Date | null;
  budget?: number;
  spentAmount: number;
  status: string;
  _count: {
    gifts: number;
  };
}

interface CampaignListProps {
  campaigns: Campaign[];
}

const campaignTypeLabels: Record<string, string> = {
  SOCIAL_MEDIA: 'شبکه‌های اجتماعی',
  EMAIL: 'ایمیل',
  PRINT: 'چاپی',
  EVENT: 'رویداد',
  OTHER: 'سایر',
};

const statusColors: Record<string, string> = {
  PLANNED: 'bg-gray-100 text-gray-700 border-gray-200',
  ACTIVE: 'bg-green-100 text-green-700 border-green-200',
  COMPLETED: 'bg-blue-100 text-blue-700 border-blue-200',
  CANCELLED: 'bg-red-100 text-red-700 border-red-200',
};

const statusLabels: Record<string, string> = {
  PLANNED: 'برنامه‌ریزی شده',
  ACTIVE: 'فعال',
  COMPLETED: 'تکمیل شده',
  CANCELLED: 'لغو شده',
};

export function CampaignList({ campaigns }: CampaignListProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fa-IR').format(Math.round(amount)) + ' تومان';
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('fa-IR').format(num);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>لیست کمپین‌ها</CardTitle>
      </CardHeader>
      <CardContent>
        {campaigns.length > 0 ? (
          <div className="space-y-4">
            {campaigns.map((campaign) => {
              const budgetPercent = campaign.budget && campaign.budget > 0
                ? (campaign.spentAmount / campaign.budget) * 100
                : 0;

              return (
                <div
                  key={campaign.id}
                  className="border rounded-lg p-4 space-y-3 animate-fade-in-up"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-lg">{campaign.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {campaign.description || 'بدون توضیحات'}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={statusColors[campaign.status] || statusColors.PLANNED}
                    >
                      {statusLabels[campaign.status] || campaign.status}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">نوع: </span>
                      <span>{campaignTypeLabels[campaign.type] || campaign.type}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">تعداد هدایا: </span>
                      <span className="font-medium">{formatNumber(campaign._count.gifts)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">شروع: </span>
                      <span>{formatJalaliDate(campaign.startDate)}</span>
                    </div>
                    {campaign.endDate && (
                      <div>
                        <span className="text-muted-foreground">پایان: </span>
                        <span>{formatJalaliDate(campaign.endDate)}</span>
                      </div>
                    )}
                  </div>

                  {campaign.budget && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">بودجه:</span>
                        <div className="flex gap-4">
                          <span>
                            هزینه شده: <span className="font-medium text-red-600">{formatCurrency(campaign.spentAmount)}</span>
                          </span>
                          <span>
                            از <span className="font-medium">{formatCurrency(campaign.budget)}</span>
                          </span>
                        </div>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all"
                          style={{ width: `${Math.min(budgetPercent, 100)}%` }}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground text-left">
                        {budgetPercent.toFixed(1)}% استفاده شده
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            هیچ کمپین بازاریابی ثبت نشده است.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

