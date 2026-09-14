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
import { getInventoryByWarehouse } from '@/actions/inventory';
import { storedPendingCount } from '@/lib/audit-scan-queue';
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

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
  warehouseId: string;
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
  audit: {
    items: Array<{
      systemQuantity: number;
      finalQuantity: number | null;
      countedQuantity1: number | null;
      countedQuantity2: number | null;
      countedQuantity3: number | null;
    }>;
  };
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
  isAdmin: boolean;
}

/** Counts of this audit that the count screen kept in this browser without a confirmed save. */
function countUnsavedOnDevice(auditId: string): number {
  try {
    const storage = window.localStorage;
    return ([1, 2, 3] as const).reduce((sum, round) => sum + storedPendingCount(storage, auditId, round), 0);
  } catch {
    return 0; // Storage blocked: the count screen could not keep anything here either.
  }
}

export function PostAuditTab({ audit, isAdmin }: PostAuditTabProps) {
  const router = useRouter();
  const [discrepancyReport, setDiscrepancyReport] = useState<DiscrepancyReport | undefined>(undefined);
  const [performanceReport, setPerformanceReport] = useState<PerformanceReport | undefined>(undefined);
  const [currentStock, setCurrentStock] = useState<Map<string, number> | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | undefined>(undefined);
  const [unsavedOnDevice, setUnsavedOnDevice] = useState(0);
  const [issueResult, setIssueResult] = useState<
    { adjustedCount: number; unitsUp: number; unitsDown: number } | undefined
  >(undefined);

  useEffect(() => {
    loadReports();
  }, [audit.id]);

  const loadReports = async () => {
    setLoading(true);
    try {
      const [discrepancy, performance, stock] = await Promise.all([
        getDiscrepancyReport(audit.id),
        getPerformanceReport(audit.id),
        // Only feeds the «موجودی فعلی» and «پس از صدور» columns, so the reports still show if it fails.
        audit.status === 'IN_PROGRESS'
          ? getInventoryByWarehouse(audit.warehouseId).catch(() => undefined)
          : undefined,
      ]);
      setDiscrepancyReport(discrepancy);
      setPerformanceReport(performance);
      setCurrentStock(
        stock &&
          new Map(stock.map((row: { productId: string; quantity: number }): [string, number] => [row.productId, row.quantity]))
      );
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

  const openIssueDialog = () => {
    setIssueError(undefined);
    setUnsavedOnDevice(countUnsavedOnDevice(audit.id));
    setConfirmOpen(true);
    // Reload, so the summary includes counts and final quantities saved since the tab opened, here or on another device.
    loadReports();
  };

  const handleIssueAdjustments = async () => {
    setIssuing(true);
    setIssueError(undefined);
    try {
      const result = await issueAdjustmentDocuments(audit.id);
      if (result.success) {
        toast.success(result.message);
        setIssueResult(result.data);
        setConfirmOpen(false);
        loadReports();
        router.refresh();
      } else {
        setIssueError(result.message);
        toast.error(result.message);
      }
    } catch (error) {
      console.error('Error issuing adjustment documents:', error);
      const message =
        'خطا در ارتباط با سرور. صفحه را تازه کنید؛ اگر «انبارگردانی تکمیل شد» را نمی‌بینید، دوباره صادر کنید.';
      setIssueError(message);
      toast.error(message);
    } finally {
      setIssuing(false);
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

  // Shortage and excess valued separately, so one cannot hide the other in the net.
  let shortageValue = 0;
  let excessValue = 0;
  for (const item of discrepancyReport?.audit?.items ?? []) {
    const value = Number(item.discrepancyValue || 0);
    if (value < 0) shortageValue -= value;
    else excessValue += value;
  }

  // Issuing adds the discrepancy to current stock. Only shown before issuing: afterwards current stock already includes it.
  const showStockColumns = audit.status === 'IN_PROGRESS' && currentStock !== undefined;

  // What issuing will do, by the rules issueAdjustmentDocuments applies, from the reports loaded last.
  const issueSummary = { itemsUp: 0, unitsUp: 0, itemsDown: 0, unitsDown: 0, notFinal: 0, notCounted: 0, countChanged: 0 };
  for (const item of performanceReport?.audit.items ?? []) {
    if (item.finalQuantity == null) {
      if (item.countedQuantity1 != null || item.countedQuantity2 != null || item.countedQuantity3 != null) {
        issueSummary.notFinal++;
      } else if (item.systemQuantity !== 0) {
        issueSummary.notCounted++;
      }
      continue;
    }
    // Issuing uses the final quantity, also when the item was counted again with another number after it.
    const lastCount = item.countedQuantity3 ?? item.countedQuantity2 ?? item.countedQuantity1;
    if (lastCount != null && lastCount !== item.finalQuantity) issueSummary.countChanged++;
    const adjustment = item.finalQuantity - item.systemQuantity;
    if (adjustment > 0) {
      issueSummary.itemsUp++;
      issueSummary.unitsUp += adjustment;
    } else if (adjustment < 0) {
      issueSummary.itemsDown++;
      issueSummary.unitsDown -= adjustment;
    }
  }

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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
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
                  <DollarSign className="h-4 w-4 text-red-500" />
                  <span className="text-sm text-muted-foreground">ارزش کسری</span>
                </div>
                <p className="text-2xl font-bold text-red-600">
                  {shortageValue.toLocaleString('fa-IR')} تومان
                </p>
              </div>
              <div className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-muted-foreground">ارزش اضافی</span>
                </div>
                <p className="text-2xl font-bold text-green-600">
                  {excessValue.toLocaleString('fa-IR')} تومان
                </p>
              </div>
              <div className="p-4 border rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">خالص (اضافی منهای کسری)</span>
                </div>
                <p className="text-2xl font-bold">
                  {Number(discrepancyReport.totalDiscrepancyValue).toLocaleString('fa-IR')} تومان
                </p>
              </div>
            </div>

            {hasDiscrepancies ? (
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {showStockColumns && (
                  <p className="text-sm text-muted-foreground">
                    «پس از صدور» یعنی موجودی فعلی به‌علاوه مغایرت. اگر بعد از فریز فروش یا جابه‌جایی ثبت شده باشد، با «مقدار نهایی» فرق دارد.
                  </p>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>محصول</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>موجودی سیستم</TableHead>
                      <TableHead>مقدار نهایی</TableHead>
                      <TableHead>مغایرت</TableHead>
                      {showStockColumns && <TableHead>موجودی فعلی</TableHead>}
                      {showStockColumns && <TableHead>پس از صدور</TableHead>}
                      <TableHead>ارزش مغایرت</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {discrepancyReport.audit.items?.map((item) => {
                      const discrepancy = item.discrepancy || 0;
                      const stock = currentStock?.get(item.productId) ?? 0;
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
                          {showStockColumns && <TableCell>{stock}</TableCell>}
                          {showStockColumns && <TableCell>{stock + discrepancy}</TableCell>}
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

      {/* Issue Adjustment Documents / Complete Audit */}
      {isAdmin && discrepancyReport && audit.status === 'IN_PROGRESS' && !issueResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {hasDiscrepancies ? 'صدور اسناد اصلاحی' : 'تکمیل انبارگردانی'}
            </CardTitle>
            <CardDescription>
              {hasDiscrepancies
                ? 'اسناد اصلاحی (رسید و حواله تعدیلی) برای همسان‌سازی موجودی سیستم و فیزیکی صادر کنید.'
                : 'هیچ مغایرتی وجود ندارد. می‌توانید انبارگردانی را بدون صدور سند اصلاحی تکمیل کنید.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={openIssueDialog} variant="default" disabled={issuing}>
              <FileText className="h-4 w-4 mr-2" />
              {issuing ? 'در حال صدور...' : hasDiscrepancies ? 'صدور اسناد اصلاحی' : 'تکمیل انبارگردانی'}
            </Button>
            <p className="text-sm text-muted-foreground mt-2">
              {hasDiscrepancies
                ? 'با صدور اسناد، موجودی سیستم به‌روزرسانی می‌شود و انبارگردانی به‌صورت خودکار تکمیل می‌شود.'
                : 'با تکمیل، وضعیت انبارگردانی به «تکمیل شده» تغییر می‌کند.'}
            </p>
          </CardContent>
        </Card>
      )}

      {issueResult && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="py-6">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="h-5 w-5" />
              <p className="font-semibold">
                اسناد اصلاحی برای {issueResult.adjustedCount} آیتم صادر شد: {issueResult.unitsUp} عدد افزایش، {issueResult.unitsDown} عدد کاهش.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <AlertDialog
          open={confirmOpen}
          onOpenChange={(open) => {
            if (!issuing) setConfirmOpen(open);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{hasDiscrepancies ? 'صدور اسناد اصلاحی' : 'تکمیل انبارگردانی'}</AlertDialogTitle>
              <AlertDialogDescription>
                این خلاصه را بررسی کنید. با تأیید، موجودی سیستم و سایت تغییر می‌کند و انبارگردانی تکمیل می‌شود.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {loading ? (
              <p className="text-sm text-muted-foreground">در حال بارگذاری...</p>
            ) : (
              <div className="space-y-3 text-sm">
                {performanceReport ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 border rounded-lg">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <TrendingUp className="h-4 w-4 text-green-500" />
                          افزایش موجودی
                        </div>
                        <p className="mt-1 font-semibold text-green-600">
                          {issueSummary.itemsUp} آیتم، {issueSummary.unitsUp} عدد
                        </p>
                      </div>
                      <div className="p-3 border rounded-lg">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <TrendingDown className="h-4 w-4 text-red-500" />
                          کاهش موجودی
                        </div>
                        <p className="mt-1 font-semibold text-red-600">
                          {issueSummary.itemsDown} آیتم، {issueSummary.unitsDown} عدد
                        </p>
                      </div>
                    </div>
                    <div className="p-3 border rounded-lg space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span>شمارش‌شده ولی بدون مقدار نهایی</span>
                        <span className={issueSummary.notFinal > 0 ? 'font-semibold text-red-600' : 'font-semibold'}>
                          {issueSummary.notFinal} آیتم
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span>شمارش‌نشده با موجودی سیستمی</span>
                        <span className={issueSummary.notCounted > 0 ? 'font-semibold text-red-600' : 'font-semibold'}>
                          {issueSummary.notCounted} آیتم
                        </span>
                      </div>
                      {(issueSummary.notFinal > 0 || issueSummary.notCounted > 0) && (
                        <p className="text-red-600">
                          تا هر دو صفر نشوند، صدور انجام نمی‌شود. در «حین عملیات» این آیتم‌ها را بشمارید، نهایی کنید یا صفر ثبت کنید.
                        </p>
                      )}
                      {issueSummary.countChanged > 0 && (
                        <p className="text-amber-700">
                          {issueSummary.countChanged} آیتم: آخرین شمارش با مقدار نهایی فرق دارد. صدور از مقدار نهایی انجام می‌شود.
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground">خلاصه بارگذاری نشد. پنجره را ببندید و دوباره باز کنید.</p>
                )}
                {unsavedOnDevice > 0 && (
                  <p className="p-3 rounded-lg border border-red-200 bg-red-50 font-semibold text-red-700">
                    {unsavedOnDevice} شمارش روی این دستگاه ذخیره نشده است. به «حین عملیات» برگردید تا ذخیره شود؛ بعد از صدور دیگر ذخیره نمی‌شود.
                  </p>
                )}
                {issueError && (
                  <div className="flex gap-2 p-3 rounded-lg border border-red-200 bg-red-50 text-red-700">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <p>{issueError}</p>
                  </div>
                )}
                <p className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900">
                  بعد از صدور، اگر ۱۰ فریم یا بیشتر ناموجود شوند، در تنظیمات › اتصال سایت آزادشان کنید.
                </p>
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={issuing}>انصراف</AlertDialogCancel>
              <Button onClick={handleIssueAdjustments} disabled={issuing || loading}>
                {issuing ? 'در حال صدور...' : hasDiscrepancies ? 'صدور اسناد اصلاحی' : 'تکمیل انبارگردانی'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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




