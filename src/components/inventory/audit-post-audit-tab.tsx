'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  calculateDiscrepancies,
  getDiscrepancyReport,
  issueAdjustmentDocuments,
  getPerformanceReport,
} from '@/actions/inventory-audit';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import {
  FileText,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Users,
  CheckCircle2,
  AlertCircle,
  BarChart3,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Product {
  id: string;
  name: string;
  sku: string;
}

interface InventoryAuditItem {
  id: string;
  productId: string;
  systemQuantity: number;
  finalQuantity?: number;
  discrepancy?: number;
  discrepancyValue?: number;
  product: Product;
}

interface InventoryAudit {
  id: string;
  status: string;
  completedDate?: Date | string;
  items?: InventoryAuditItem[];
}

interface DiscrepancyReport {
  totalItems: number;
  shortageCount: number;
  excessCount: number;
  totalDiscrepancyValue: number;
  audit: InventoryAudit;
}

interface PerformanceReport {
  statistics: {
    totalItems: number;
    countedItems: number;
    itemsWithDiscrepancy: number;
    accuracy: number;
  };
  countByUser?: Array<{
    name: string;
    count: number;
  }>;
}

interface PostAuditTabProps {
  audit: InventoryAudit;
}

export function PostAuditTab({ audit }: PostAuditTabProps) {
  const router = useRouter();
  const [discrepancyReport, setDiscrepancyReport] = useState<DiscrepancyReport | null>(null);
  const [performanceReport, setPerformanceReport] = useState<PerformanceReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadReports();
  }, [audit.id]);

  const loadReports = async () => {
    setLoading(true);
    try {
      const [discrepancy, performance] = await Promise.all([
        getDiscrepancyReport(audit.id),
        getPerformanceReport(audit.id),
      ]);
      setDiscrepancyReport(discrepancy);
      setPerformanceReport(performance);
    } catch (error) {
      console.error('Error loading reports:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCalculateDiscrepancies = async () => {
    const result = await calculateDiscrepancies(audit.id);
    if (result.success) {
      toast.success(result.message);
      loadReports();
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  const handleIssueAdjustments = async () => {
    if (
      !confirm(
        'آیا مطمئن هستید که می‌خواهید اسناد اصلاحی صادر کنید؟ این عمل موجودی سیستم را تغییر می‌دهد.'
      )
    ) {
      return;
    }

    const result = await issueAdjustmentDocuments(audit.id);
    if (result.success) {
      toast.success(result.message);
      loadReports();
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  if (audit.status !== 'IN_PROGRESS' && audit.status !== 'COMPLETED') {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">
            برای مشاهده گزارش‌ها، انبارگردانی باید در حال انجام یا تکمیل شده باشد.
          </p>
        </CardContent>
      </Card>
    );
  }

  const hasDiscrepancies =
    discrepancyReport?.audit?.items?.some(
      (item) => item.discrepancy !== null && item.discrepancy !== 0
    ) || false;

  return (
    <div className="space-y-6">
      {/* Calculate Discrepancies Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            محاسبه مغایرت‌ها
          </CardTitle>
          <CardDescription>
            مغایرت‌های موجودی سیستم و فیزیکی را محاسبه کنید.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleCalculateDiscrepancies} disabled={loading}>
            <BarChart3 className="h-4 w-4 mr-2" />
            محاسبه مغایرت‌ها
          </Button>
        </CardContent>
      </Card>

      {/* Discrepancy Report */}
      {discrepancyReport && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              گزارش مغایرت‌ها
            </CardTitle>
            <CardDescription>
              لیست کالاهای دارای مغایرت (کسری و اضافی)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">کل مغایرت‌ها</span>
                </div>
                <p className="text-2xl font-bold">{discrepancyReport.totalItems}</p>
              </div>
              <div className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingDown className="h-4 w-4 text-red-500" />
                  <span className="text-sm text-muted-foreground">کسری</span>
                </div>
                <p className="text-2xl font-bold text-red-600">{discrepancyReport.shortageCount}</p>
              </div>
              <div className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-muted-foreground">اضافی</span>
                </div>
                <p className="text-2xl font-bold text-green-600">{discrepancyReport.excessCount}</p>
              </div>
              <div className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">ارزش کل</span>
                </div>
                <p className="text-2xl font-bold">
                  {Number(discrepancyReport.totalDiscrepancyValue).toLocaleString('fa-IR')} تومان
                </p>
              </div>
            </div>

            {hasDiscrepancies ? (
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>محصول</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>موجودی سیستم</TableHead>
                      <TableHead>مقدار نهایی</TableHead>
                      <TableHead>مغایرت</TableHead>
                      <TableHead>ارزش مغایرت</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {discrepancyReport.audit.items?.map((item) => {
                      const discrepancy = item.discrepancy || 0;
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.product.name}</TableCell>
                          <TableCell>{item.product.sku}</TableCell>
                          <TableCell>{item.systemQuantity}</TableCell>
                          <TableCell>{item.finalQuantity}</TableCell>
                          <TableCell>
                            <Badge
                              variant={discrepancy > 0 ? 'default' : 'destructive'}
                            >
                              {discrepancy > 0 ? '+' : ''}
                              {discrepancy}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {Number(item.discrepancyValue || 0).toLocaleString('fa-IR')} تومان
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                هیچ مغایرتی یافت نشد.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Issue Adjustment Documents */}
      {hasDiscrepancies && audit.status === 'IN_PROGRESS' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              صدور اسناد اصلاحی
            </CardTitle>
            <CardDescription>
              اسناد اصلاحی (رسید و حواله تعدیلی) برای همسان‌سازی موجودی سیستم و فیزیکی صادر کنید.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleIssueAdjustments} variant="default">
              <FileText className="h-4 w-4 mr-2" />
              صدور اسناد اصلاحی
            </Button>
            <p className="text-sm text-muted-foreground mt-2">
              با صدور اسناد، موجودی سیستم به‌روزرسانی می‌شود و انبارگردانی به‌صورت خودکار تکمیل می‌شود.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Performance Report */}
      {performanceReport && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              گزارش عملکرد
            </CardTitle>
            <CardDescription>
              آمار عملکرد تیم‌های شمارش و دقت انبارداری
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">کل آیتم‌ها</span>
                </div>
                <p className="text-2xl font-bold">
                  {performanceReport.statistics.totalItems}
                </p>
              </div>
              <div className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-muted-foreground">شمارش شده</span>
                </div>
                <p className="text-2xl font-bold text-green-600">
                  {performanceReport.statistics.countedItems}
                </p>
              </div>
              <div className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="h-4 w-4 text-orange-500" />
                  <span className="text-sm text-muted-foreground">دارای مغایرت</span>
                </div>
                <p className="text-2xl font-bold text-orange-600">
                  {performanceReport.statistics.itemsWithDiscrepancy}
                </p>
              </div>
              <div className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-4 w-4 text-blue-500" />
                  <span className="text-sm text-muted-foreground">دقت</span>
                </div>
                <p className="text-2xl font-bold text-blue-600">
                  {performanceReport.statistics.accuracy.toFixed(1)}%
                </p>
              </div>
            </div>

            {performanceReport.countByUser && performanceReport.countByUser.length > 0 && (
              <div>
                <h3 className="font-semibold mb-4">آمار شمارش به تفکیک کاربر</h3>
                <div className="space-y-2">
                  {performanceReport.countByUser.map((user, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <span className="font-medium">{user.name}</span>
                      <Badge variant="secondary">{user.count} آیتم</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Completion Status */}
      {audit.status === 'COMPLETED' && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="py-6">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="h-5 w-5" />
              <div>
                <p className="font-semibold">انبارگردانی تکمیل شد</p>
                <p className="text-sm text-green-600">
                  در تاریخ: {audit.completedDate && new Date(audit.completedDate).toLocaleDateString('fa-IR')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}



