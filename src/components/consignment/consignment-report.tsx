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
import {
  DollarSign,
  Users,
  Package,
  TrendingUp,
  AlertTriangle,
  ShoppingCart,
  Warehouse,
} from 'lucide-react';
import { formatJalaliDate } from '@/lib/date-utils';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

interface ConsignmentReportProps {
  reportData: {
    partners: Array<{
      partnerId: string;
      partnerName: string;
      customerId: string;
      commissionRate: number | null;
      totalSales: number;
      totalPaid: number;
      totalDebt: number;
      totalCommissions: number;
      paidCommissions: number;
      unpaidCommissions: number;
      inventoryValue: number;
      inventoryQuantity: number;
      productCount: number;
      orderCount: number;
      orders: any[];
    }>;
    grandTotals: {
      totalPartners: number;
      totalSales: number;
      totalPaid: number;
      totalDebt: number;
      totalCommissions: number;
      paidCommissions: number;
      unpaidCommissions: number;
      totalInventoryValue: number;
      totalInventoryQuantity: number;
      totalOrders: number;
    };
  };
}

export function ConsignmentReport({ reportData }: ConsignmentReportProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fa-IR').format(Math.round(amount)) + ' تومان';
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('fa-IR').format(num);
  };

  return (
    <div className="space-y-6">
      {/* Grand Totals Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">کل فروش همکاران</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(reportData.grandTotals.totalSales)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              مجموع فروش‌های ثبت شده
            </p>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">کل طلب از همکاران</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(reportData.grandTotals.totalDebt)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              بدهی پرداخت نشده همکاران
            </p>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">کمیسیون پرداخت نشده</CardTitle>
            <DollarSign className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(reportData.grandTotals.unpaidCommissions)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              کمیسیون‌های پرداخت نشده
            </p>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">ارزش موجودی امانی</CardTitle>
            <Package className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(reportData.grandTotals.totalInventoryValue)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              ارزش موجودی در انبارهای امانی
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Additional Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="animate-fade-in-up" style={{ animationDelay: '0.5s' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">تعداد همکاران</CardTitle>
            <Users className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(reportData.grandTotals.totalPartners)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              همکاران فعال
            </p>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up" style={{ animationDelay: '0.6s' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">تعداد سفارشات</CardTitle>
            <ShoppingCart className="h-4 w-4 text-indigo-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(reportData.grandTotals.totalOrders)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              سفارشات ثبت شده
            </p>
          </CardContent>
        </Card>

        <Card className="animate-fade-in-up" style={{ animationDelay: '0.7s' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">موجودی کل</CardTitle>
            <Warehouse className="h-4 w-4 text-teal-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(reportData.grandTotals.totalInventoryQuantity)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              واحد محصول در انبارهای امانی
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Partners Detail */}
      {reportData.partners.length > 0 ? (
        <div className="space-y-6">
          {reportData.partners.map((partner, index) => (
            <Card key={partner.partnerId} className="animate-fade-in-up" style={{ animationDelay: `${0.1 * index}s` }}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {partner.partnerName}
                      {partner.commissionRate && (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                          کمیسیون: {partner.commissionRate}%
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-2">
                      <div className="flex gap-4 text-sm">
                        <span>تعداد سفارشات: {formatNumber(partner.orderCount)}</span>
                        <span>تعداد محصولات: {formatNumber(partner.productCount)}</span>
                        <span>موجودی: {formatNumber(partner.inventoryQuantity)} واحد</span>
                      </div>
                    </CardDescription>
                  </div>
                  <div className="text-left">
                    <Link href={`/dashboard/consignment/partners`}>
                      <Button variant="outline" size="sm">
                        مشاهده جزئیات
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">کل فروش</p>
                    <p className="text-lg font-bold">{formatCurrency(partner.totalSales)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">پرداخت شده</p>
                    <p className="text-lg font-bold text-green-600">{formatCurrency(partner.totalPaid)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">طلب</p>
                    <p className="text-lg font-bold text-orange-600">{formatCurrency(partner.totalDebt)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">ارزش موجودی</p>
                    <p className="text-lg font-bold text-blue-600">{formatCurrency(partner.inventoryValue)}</p>
                  </div>
                </div>

                {partner.commissionRate && (
                  <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-muted/50 rounded-lg">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">کل کمیسیون</p>
                      <p className="text-lg font-bold">{formatCurrency(partner.totalCommissions)}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">پرداخت شده</p>
                      <p className="text-lg font-bold text-green-600">{formatCurrency(partner.paidCommissions)}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">پرداخت نشده</p>
                      <p className="text-lg font-bold text-red-600">{formatCurrency(partner.unpaidCommissions)}</p>
                    </div>
                  </div>
                )}

                {partner.orders.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-3">آخرین سفارشات</h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-right">شماره سفارش</TableHead>
                          <TableHead className="text-right">تاریخ</TableHead>
                          <TableHead className="text-right">مبلغ</TableHead>
                          <TableHead className="text-right">پرداخت شده</TableHead>
                          <TableHead className="text-right">وضعیت</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {partner.orders.map((order, orderIndex) => (
                          <TableRow key={order.id} className="animate-fade-in-up" style={{ animationDelay: `${0.05 * orderIndex}s` }}>
                            <TableCell className="font-medium">
                              <Link href={`/dashboard/sales/orders/${order.id}`} className="hover:underline text-blue-600">
                                #{formatNumber(order.number)}
                              </Link>
                            </TableCell>
                            <TableCell>{formatJalaliDate(order.createdAt)}</TableCell>
                            <TableCell>{formatCurrency(Number(order.totalAmount) - Number(order.discount || 0))}</TableCell>
                            <TableCell>{formatCurrency(Number(order.paidAmount || 0))}</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={
                                  order.paymentStatus === 'PAID'
                                    ? 'bg-green-50 text-green-700 border-green-200'
                                    : order.paymentStatus === 'PARTIAL'
                                    ? 'bg-orange-50 text-orange-700 border-orange-200'
                                    : 'bg-red-50 text-red-700 border-red-200'
                                }
                              >
                                {order.paymentStatus === 'PAID'
                                  ? 'پرداخت شده'
                                  : order.paymentStatus === 'PARTIAL'
                                  ? 'جزئی'
                                  : 'پرداخت نشده'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            هیچ همکار امانی‌ای یافت نشد.
          </CardContent>
        </Card>
      )}
    </div>
  );
}



