'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { recordCount, recordCountByBarcode, setFinalQuantity } from '@/actions/inventory-audit';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Scan, Save, CheckCircle2, XCircle, Search, Wifi, WifiOff, Camera, Plus, Trash2 } from 'lucide-react';
import { BarcodeScannerDialog } from '@/components/inventory/barcode-scanner';
import { 
  isOnline, 
  setupOnlineListener, 
  getPendingCounts, 
  syncPendingCounts, 
  saveCountOffline 
} from '@/lib/offline-storage';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface ExecutionTabProps {
  audit: any;
}

export function ExecutionTab({ audit }: ExecutionTabProps) {
  const router = useRouter();
  const [barcode, setBarcode] = useState('');
  const [manualProductId, setManualProductId] = useState('');
  const [count, setCount] = useState('');
  const [countRound, setCountRound] = useState<1 | 2 | 3>(1);
  const [notes, setNotes] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [online, setOnline] = useState(true);
  const [pendingCounts, setPendingCounts] = useState<any[]>([]);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [manualEntries, setManualEntries] = useState<Array<{ productId: string; count: string; notes: string }>>([]);

  useEffect(() => {
    setOnline(isOnline());
    loadPendingCounts();
    const cleanup = setupOnlineListener(() => {
      setOnline(true);
      syncAllPendingCounts();
    });
    return cleanup;
  }, []);

  const loadPendingCounts = async () => {
    try {
      const counts = await getPendingCounts(audit.id);
      setPendingCounts(counts);
    } catch (error) {
      console.error('Error loading pending counts:', error);
    }
  };

  const syncAllPendingCounts = async () => {
    if (!online) return;

    try {
      const { synced, failed } = await syncPendingCounts(async (count) => {
        if (count.productId) {
          return await recordCount(
            count.auditId,
            count.productId,
            count.count,
            count.countRound,
            count.notes
          );
        }
        return { success: false };
      });

      if (synced > 0) {
        toast.success(`${synced} شمارش با موفقیت همگام‌سازی شد.`);
        loadPendingCounts();
        router.refresh();
      }
      if (failed > 0) {
        toast.error(`${failed} شمارش با خطا مواجه شد.`);
      }
    } catch (error) {
      console.error('Error syncing counts:', error);
    }
  };

  // Check if audit is in progress
  if (audit.status !== 'IN_PROGRESS') {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">
            برای شروع شمارش، ابتدا موجودی را فریز کنید.
          </p>
        </CardContent>
      </Card>
    );
  }

  const handleBarcodeScan = async () => {
    if (!barcode.trim()) {
      toast.error('لطفاً بارکد را وارد کنید.');
      return;
    }

    if (!count.trim() || isNaN(Number(count))) {
      toast.error('لطفاً تعداد را به درستی وارد کنید.');
      return;
    }

    if (!online) {
      // Save offline - we need productId from barcode, but for now save with barcode
      toast.info('در حال ذخیره آفلاین...');
      // Note: For offline barcode, we'd need to lookup productId first
      // This is a simplified version
      return;
    }

    const result = await recordCountByBarcode(audit.id, barcode, Number(count), countRound);
    if (result.success) {
      toast.success(result.message);
      setBarcode('');
      setCount('');
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  const addManualEntry = () => {
    if (!manualProductId) {
      toast.error('لطفاً محصول را انتخاب کنید.');
      return;
    }

    if (!count.trim() || isNaN(Number(count)) || Number(count) <= 0) {
      toast.error('لطفاً تعداد را به درستی وارد کنید.');
      return;
    }

    // Check if product already exists in entries
    if (manualEntries.some(entry => entry.productId === manualProductId)) {
      toast.error('این محصول قبلاً به لیست اضافه شده است.');
      return;
    }

    setManualEntries([...manualEntries, {
      productId: manualProductId,
      count: count,
      notes: notes
    }]);

    // Reset form
    setManualProductId('');
    setCount('');
    setNotes('');
  };

  const removeManualEntry = (index: number) => {
    setManualEntries(manualEntries.filter((_, i) => i !== index));
  };

  const handleManualCount = async (productId?: string, countValue?: string, notesValue?: string) => {
    const targetProductId = productId || manualProductId;
    const targetCount = countValue || count;
    const targetNotes = notesValue || notes;

    if (!targetProductId) {
      toast.error('لطفاً محصول را انتخاب کنید.');
      return;
    }

    if (!targetCount.trim() || isNaN(Number(targetCount))) {
      toast.error('لطفاً تعداد را به درستی وارد کنید.');
      return;
    }

    if (!online) {
      // Save offline
      try {
        await saveCountOffline(
          audit.id,
          targetProductId,
          Number(targetCount),
          countRound,
          targetNotes || undefined
        );
        toast.success('شمارش به صورت آفلاین ذخیره شد. پس از اتصال به اینترنت همگام‌سازی می‌شود.');
        loadPendingCounts();
      } catch (error) {
        toast.error('خطا در ذخیره آفلاین.');
      }
      return;
    }

    const result = await recordCount(audit.id, targetProductId, Number(targetCount), countRound, targetNotes);
    if (result.success) {
      toast.success(result.message);
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  const handleBatchManualCount = async () => {
    if (manualEntries.length === 0) {
      toast.error('لطفاً حداقل یک آیتم به لیست اضافه کنید.');
      return;
    }

    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (const entry of manualEntries) {
      const targetProductId = entry.productId;
      const targetCount = entry.count;
      const targetNotes = entry.notes;

      if (!targetProductId || !targetCount.trim() || isNaN(Number(targetCount))) {
        errorCount++;
        errors.push('داده‌های نامعتبر');
        continue;
      }

      if (!online) {
        // Save offline
        try {
          await saveCountOffline(
            audit.id,
            targetProductId,
            Number(targetCount),
            countRound,
            targetNotes || undefined
          );
          successCount++;
        } catch (error: any) {
          errorCount++;
          console.error('Error saving offline:', error);
          errors.push(error?.message || 'خطا در ذخیره آفلاین');
        }
      } else {
        try {
          const result = await recordCount(audit.id, targetProductId, Number(targetCount), countRound, targetNotes);
          if (result.success) {
            successCount++;
          } else {
            errorCount++;
            console.error('Record count error:', result.message);
            errors.push(result.message || 'خطا در ثبت شمارش');
          }
        } catch (error: any) {
          errorCount++;
          console.error('Error recording count:', error);
          errors.push(error?.message || 'خطا در ثبت شمارش');
        }
      }
    }

    if (successCount > 0) {
      toast.success(`${successCount} شمارش با موفقیت ثبت شد.`);
      setManualEntries([]);
      if (!online) {
        loadPendingCounts();
      }
      router.refresh();
    }
    if (errorCount > 0) {
      const errorMessage = errors.length > 0 
        ? `${errorCount} شمارش با خطا مواجه شد: ${errors[0]}${errors.length > 1 ? ' و ...' : ''}`
        : `${errorCount} شمارش با خطا مواجه شد.`;
      toast.error(errorMessage);
    }
  };

  const handleSetFinal = async (productId: string, finalQuantity: number) => {
    if (!confirm('آیا مطمئن هستید که می‌خواهید این مقدار را به عنوان مقدار نهایی ثبت کنید؟')) {
      return;
    }

    const result = await setFinalQuantity(audit.id, productId, finalQuantity);
    if (result.success) {
      toast.success(result.message);
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  const filteredItems = audit.items?.filter((item: any) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      item.product.name.toLowerCase().includes(query) ||
      item.product.sku.toLowerCase().includes(query)
    );
  }) || [];

  const getCountStatus = (item: any) => {
    if (item.finalQuantity !== null) {
      return { status: 'final', label: 'نهایی شده', variant: 'default' as const };
    }
    if (item.countedQuantity3 !== null) {
      return { status: 'third', label: 'شمارش سوم', variant: 'secondary' as const };
    }
    if (item.countedQuantity2 !== null) {
      return { status: 'second', label: 'شمارش دوم', variant: 'outline' as const };
    }
    if (item.countedQuantity1 !== null) {
      return { status: 'first', label: 'شمارش اول', variant: 'outline' as const };
    }
    return { status: 'none', label: 'شمارش نشده', variant: 'outline' as const };
  };

  return (
    <div className="space-y-6">
      {/* Online/Offline Status */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {online ? (
                <>
                  <Wifi className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium text-green-600">آنلاین</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-4 w-4 text-orange-600" />
                  <span className="text-sm font-medium text-orange-600">آفلاین</span>
                  <Badge variant="outline" className="text-xs">
                    {pendingCounts.length} شمارش در انتظار
                  </Badge>
                </>
              )}
            </div>
            {!online && pendingCounts.length > 0 && (
              <Button size="sm" variant="outline" onClick={syncAllPendingCounts}>
                همگام‌سازی
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="count" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="count">ثبت شمارش</TabsTrigger>
          <TabsTrigger value="items">لیست آیتم‌ها</TabsTrigger>
        </TabsList>

        <TabsContent value="count" className="space-y-4">
          {/* Barcode Scanner Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scan className="h-5 w-5" />
                اسکن بارکد
              </CardTitle>
              <CardDescription>
                بارکد را از طریق دوربین موبایل یا بارکدخوان اسکن کنید.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Select value={countRound.toString()} onValueChange={(v) => setCountRound(Number(v) as 1 | 2 | 3)}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">شمارش اول</SelectItem>
                    <SelectItem value="2">شمارش دوم</SelectItem>
                    <SelectItem value="3">شمارش سوم</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>بارکد</Label>
                <div className="flex gap-2">
                  <Input
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    placeholder="بارکد را وارد یا اسکن کنید..."
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleBarcodeScan();
                      }
                    }}
                    autoFocus
                  />
                  <Button 
                    type="button"
                    variant="outline"
                    onClick={() => setIsScannerOpen(true)}
                  >
                    <Camera className="h-4 w-4 mr-2" />
                    دوربین
                  </Button>
                  <Button onClick={handleBarcodeScan}>
                    <Scan className="h-4 w-4 mr-2" />
                    ثبت
                  </Button>
                </div>
              </div>
              <BarcodeScannerDialog
                open={isScannerOpen}
                onOpenChange={setIsScannerOpen}
                onScan={(scannedBarcode) => {
                  setBarcode(scannedBarcode);
                  setIsScannerOpen(false);
                  // Auto-focus on count input after scanning
                  setTimeout(() => {
                    const countInput = document.querySelector('input[type="number"]') as HTMLInputElement;
                    if (countInput) {
                      countInput.focus();
                    }
                  }, 100);
                }}
              />
              <div className="space-y-2">
                <Label>تعداد</Label>
                <Input
                  type="number"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  placeholder="تعداد شمارش شده"
                />
              </div>
            </CardContent>
          </Card>

          {/* Manual Entry Section */}
          <Card>
            <CardHeader>
              <CardTitle>ثبت دستی</CardTitle>
              <CardDescription>
                در صورت عدم دسترسی به بارکد، شمارش را به صورت دستی ثبت کنید. می‌توانید چندین آیتم را به لیست اضافه کرده و یکجا ثبت کنید.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>محصول</Label>
                <Select value={manualProductId} onValueChange={setManualProductId}>
                  <SelectTrigger>
                    <SelectValue placeholder="انتخاب محصول" />
                  </SelectTrigger>
                  <SelectContent>
                    {audit.items?.map((item: any) => (
                      <SelectItem 
                        key={item.productId} 
                        value={item.productId}
                        disabled={manualEntries.some(e => e.productId === item.productId)}
                      >
                        {item.product.name} ({item.product.sku})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>تعداد</Label>
                <Input
                  type="number"
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                  placeholder="تعداد شمارش شده"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      addManualEntry();
                    }
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>توضیحات (آسیب‌دیده/ضایعات)</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="توضیحات اختیاری..."
                  rows={2}
                />
              </div>
              <Button onClick={addManualEntry} variant="outline" className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                افزودن به لیست
              </Button>

              {/* List of entries */}
              {manualEntries.length > 0 && (
                <div className="space-y-2 border-t pt-4">
                  <Label>لیست آیتم‌های انتخابی ({manualEntries.length})</Label>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {manualEntries.map((entry, index) => {
                      const product = audit.items?.find((item: any) => item.productId === entry.productId)?.product;
                      return (
                        <div
                          key={index}
                          className="flex items-center justify-between p-3 border rounded-lg bg-muted/50"
                        >
                          <div className="flex-1">
                            <p className="font-medium text-sm">{product?.name}</p>
                            <p className="text-xs text-muted-foreground">
                              SKU: {product?.sku} | تعداد: {entry.count}
                              {entry.notes && ` | ${entry.notes}`}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeManualEntry(index)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button 
                      onClick={handleBatchManualCount} 
                      className="flex-1"
                      disabled={manualEntries.length === 0}
                    >
                      <Save className="h-4 w-4 mr-2" />
                      ثبت همه ({manualEntries.length})
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setManualEntries([])}
                      disabled={manualEntries.length === 0}
                    >
                      پاک کردن لیست
                    </Button>
                  </div>
                </div>
              )}

              {/* Single entry button (for backward compatibility) */}
              {manualEntries.length === 0 && (
                <Button onClick={() => handleManualCount()} className="w-full">
                  <Save className="h-4 w-4 mr-2" />
                  ثبت شمارش
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="items">
          <Card>
            <CardHeader>
              <CardTitle>لیست آیتم‌های شمارش</CardTitle>
              <CardDescription>
                وضعیت شمارش تمام آیتم‌ها را مشاهده و مدیریت کنید.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="جستجو محصول..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {filteredItems.map((item: any) => {
                  const countStatus = getCountStatus(item);
                  return (
                    <div
                      key={item.id}
                      className="p-4 border rounded-lg space-y-3"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium">{item.product.name}</p>
                          <p className="text-sm text-muted-foreground">{item.product.sku}</p>
                        </div>
                        <Badge variant={countStatus.variant}>{countStatus.label}</Badge>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">موجودی سیستم:</span>
                          <span className="font-medium mr-2">{item.systemQuantity}</span>
                        </div>
                        {item.countedQuantity1 !== null && (
                          <div>
                            <span className="text-muted-foreground">شمارش اول:</span>
                            <span className="font-medium mr-2">{item.countedQuantity1}</span>
                          </div>
                        )}
                        {item.countedQuantity2 !== null && (
                          <div>
                            <span className="text-muted-foreground">شمارش دوم:</span>
                            <span className="font-medium mr-2">{item.countedQuantity2}</span>
                          </div>
                        )}
                        {item.countedQuantity3 !== null && (
                          <div>
                            <span className="text-muted-foreground">شمارش سوم:</span>
                            <span className="font-medium mr-2">{item.countedQuantity3}</span>
                          </div>
                        )}
                        {item.finalQuantity !== null && (
                          <div>
                            <span className="text-muted-foreground">مقدار نهایی:</span>
                            <span className="font-medium mr-2 text-green-600">
                              {item.finalQuantity}
                            </span>
                          </div>
                        )}
                      </div>
                      {item.notes && (
                        <div className="text-sm text-muted-foreground">
                          <span className="font-medium">توضیحات:</span> {item.notes}
                        </div>
                      )}
                      {item.countedQuantity1 !== null && item.finalQuantity === null && (
                        <div className="flex gap-2 items-center">
                          <Input
                            type="number"
                            placeholder="مقدار نهایی"
                            className="w-32"
                            defaultValue={
                              // Auto-suggest: use last count or average if multiple counts exist
                              item.countedQuantity3 !== null 
                                ? item.countedQuantity3 
                                : item.countedQuantity2 !== null 
                                ? item.countedQuantity2 
                                : item.countedQuantity1
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const finalQty = Number((e.target as HTMLInputElement).value);
                                if (!isNaN(finalQty) && finalQty >= 0) {
                                  handleSetFinal(item.productId, finalQty);
                                }
                              }
                            }}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              // Auto-set to last count
                              const suggestedQty = item.countedQuantity3 !== null 
                                ? item.countedQuantity3 
                                : item.countedQuantity2 !== null 
                                ? item.countedQuantity2 
                                : item.countedQuantity1;
                              handleSetFinal(item.productId, suggestedQty);
                            }}
                            title="استفاده از آخرین شمارش"
                          >
                            آخرین شمارش
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              const input = document.querySelector(
                                `input[placeholder="مقدار نهایی"]`
                              ) as HTMLInputElement;
                              if (input && !isNaN(Number(input.value)) && Number(input.value) >= 0) {
                                handleSetFinal(item.productId, Number(input.value));
                              } else {
                                toast.error('لطفاً مقدار معتبری وارد کنید.');
                              }
                            }}
                          >
                            <CheckCircle2 className="h-4 w-4 mr-2" />
                            ثبت نهایی
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

