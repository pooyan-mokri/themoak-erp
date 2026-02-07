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
import { Button } from '@/components/ui/button';
import { DollarSign, Users, FileText, CheckCircle2 } from 'lucide-react';
import { markCommissionAsPaid, payAllCommissionsForCustomer } from '@/actions/consignment-commissions';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { formatJalaliDate } from '@/lib/date-utils';

interface ConsignmentCommissionsReportProps {
  reportData: {
    report: Array<{
      customer: any;
      totalCommission: number;
      totalOrders: number;
      commissions: Array<{
        id: string;
        orderNumber: number;
        orderAmount: number;
        commissionRate: number;
        commissionAmount: number;
        createdAt: Date;
        order: any;
      }>;
    }>;
    grandTotal: number;
    totalPartners: number;
    totalUnpaidCommissions: number;
  };
}

export function ConsignmentCommissionsReport({ reportData }: ConsignmentCommissionsReportProps) {
  const router = useRouter();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fa-IR').format(Math.round(amount)) + ' تومان';
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('fa-IR').format(num);
  };

  const handleMarkAsPaid = async (commissionId: string) => {
    const result = await markCommissionAsPaid(commissionId);
    if (result.success) {
      toast.success(result.message);
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  const handlePayAllForCustomer = async (customerId: string) => {
    if (!confirm('آیا مطمئن هستید که می‌خواهید تمام کمیسیون‌های این همکار را به عنوان پرداخت شده علامت‌گذاری کنید؟')) {
      return;
    }
    const result = await payAllCommissionsForCustomer(customerId);
    if (result.success) {
      toast.success(result.message);
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">کل طلب از همکاران</CardTitle>
            <DollarSign className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(reportData.grandTotal)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              مجموع کمیسیون‌های پرداخت نشده
            </p>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">تعداد همکاران</CardTitle>
            <Users className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(reportData.totalPartners)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              همکارانی که طلب داریم
            </p>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">تعداد کمیسیون‌ها</CardTitle>
            <FileText className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(reportData.totalUnpaidCommissions)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              کمیسیون‌های پرداخت نشده
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Partners List */}
      {reportData.report.length > 0 ? (
        reportData.report.map((partnerData, partnerIndex) => (
          <Card key={partnerData.customer.id} className="animate-fade-in-up" style={{ animationDelay: `${0.1 * partnerIndex}s` }}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {partnerData.customer.name}
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                      {partnerData.customer.commissionRate ? `${Number(partnerData.customer.commissionRate)}%` : 'بدون کمیسیون'}
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
                    {formatNumber(partnerData.totalOrders)} سفارش
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => handlePayAllForCustomer(partnerData.customer.id)}
                  >
                    <CheckCircle2 className="h-4 w-4 ml-2" />
                    پرداخت همه
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">شماره سفارش</TableHead>
                    <TableHead className="text-right">تاریخ</TableHead>
                    <TableHead className="text-right">مبلغ سفارش</TableHead>
                    <TableHead className="text-right">درصد کمیسیون</TableHead>
                    <TableHead className="text-right">مبلغ کمیسیون</TableHead>
                    <TableHead className="text-right">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {partnerData.commissions.map((commission, index) => (
                    <TableRow key={commission.id} className="animate-fade-in-up" style={{ animationDelay: `${0.05 * index}s` }}>
                      <TableCell className="font-medium">
                        #{formatNumber(commission.orderNumber)}
                      </TableCell>
                      <TableCell>
                        {formatJalaliDate(commission.createdAt)}
                      </TableCell>
                      <TableCell>{formatCurrency(commission.orderAmount)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{commission.commissionRate}%</Badge>
                      </TableCell>
                      <TableCell className="font-bold text-green-600">
                        {formatCurrency(commission.commissionAmount)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleMarkAsPaid(commission.id)}
                        >
                          <CheckCircle2 className="h-4 w-4 ml-2" />
                          پرداخت شد
                        </Button>
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
            هیچ کمیسیون پرداخت نشده‌ای یافت نشد.
          </CardContent>
        </Card>
      )}
    </div>
  );
}




