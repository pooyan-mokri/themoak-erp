'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { DollarSign, Users, FileText } from 'lucide-react';
import { formatJalaliDate } from '@/lib/date-utils';

interface ConsignmentCommissionsReportProps {
  reportData: {
    report: Array<{
      customer: any;
      totalCommission: number; // total outstanding for the partner
      totalOrders: number;
      commissions: Array<{
        id: string;
        orderNumber: number;
        orderAmount: number;
        commissionRate: number;
        commissionAmount: number; // outstanding amount for this order
        createdAt: Date;
      }>;
    }>;
    grandTotal: number;
    totalPartners: number;
    totalUnpaidCommissions: number;
  };
}

export function ConsignmentCommissionsReport({ reportData }: ConsignmentCommissionsReportProps) {
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('fa-IR').format(Math.round(amount)) + ' تومان';
  const formatNumber = (num: number) => new Intl.NumberFormat('fa-IR').format(num);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">کل طلب از همکاران</CardTitle>
            <DollarSign className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(reportData.grandTotal)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              مجموع مانده‌ی تسویه‌نشده (سهم ما)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">تعداد همکاران بدهکار</CardTitle>
            <Users className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(reportData.totalPartners)}</div>
            <p className="text-xs text-muted-foreground mt-1">همکارانی که از آن‌ها طلب داریم</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">تعداد فاکتورهای باز</CardTitle>
            <FileText className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatNumber(reportData.totalUnpaidCommissions)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">فاکتورهای تسویه‌نشده</p>
          </CardContent>
        </Card>
      </div>

      {reportData.report.length > 0 ? (
        reportData.report.map((partnerData) => (
          <Card key={partnerData.customer.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {partnerData.customer.name}
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                      {partnerData.customer.commissionRate
                        ? `${Number(partnerData.customer.commissionRate)}%`
                        : 'بدون کمیسیون'}
                    </Badge>
                  </CardTitle>
                  <CardDescription className="mt-2">
                    {partnerData.customer.phone && `تماس: ${partnerData.customer.phone}`}
                  </CardDescription>
                </div>
                <div className="text-left">
                  <div className="text-2xl font-bold text-green-600">
                    {formatCurrency(partnerData.totalCommission)}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(partnerData.totalOrders)} فاکتور باز
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">شماره فاکتور</TableHead>
                    <TableHead className="text-right">تاریخ</TableHead>
                    <TableHead className="text-right">فروش ناخالص</TableHead>
                    <TableHead className="text-right">درصد کمیسیون</TableHead>
                    <TableHead className="text-right">مبلغ طلب (مانده)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {partnerData.commissions.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        #{formatNumber(row.orderNumber)}
                      </TableCell>
                      <TableCell>{formatJalaliDate(row.createdAt)}</TableCell>
                      <TableCell>{formatCurrency(row.orderAmount)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.commissionRate}%</Badge>
                      </TableCell>
                      <TableCell className="font-bold text-green-600">
                        {formatCurrency(row.commissionAmount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            هیچ طلب تسویه‌نشده‌ای از همکاران وجود ندارد.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
