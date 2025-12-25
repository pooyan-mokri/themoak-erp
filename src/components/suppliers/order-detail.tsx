'use client';

import { useState, useEffect } from 'react';
import { receivePurchaseOrderItems } from '@/actions/supplier';
import { updatePurchaseOrderStatus, recordPurchasePayment, recordArrival } from '@/actions/supplier-workflow';
import { getLatestExchangeRates } from '@/actions/accounting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Package, CheckCircle, ArrowRight, CreditCard, Truck, Factory } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { formatJalaliDate } from '@/lib/date-utils';
import { Plus, Trash2 } from 'lucide-react';

type Currency = 'TOMAN' | 'USD' | 'EUR' | 'CNY';

interface Product {
  id: string;
  name: string;
  sku: string;
}

interface Supplier {
  id: string;
  name: string;
}

interface PurchaseOrderItem {
  id: string;
  productId: string;
  quantity: number;
  unitCost: number;
  currency: Currency;
  unitCostInToman?: number;
  receivedQuantity: number;
  product: Product;
}

interface PurchaseOrderAdditionalCost {
  id: string;
  title: string;
  amount: number;
  currency: Currency;
  amountInToman?: number;
}

interface PurchaseOrderArrivalCost {
  id: string;
  title: string;
  amount: number;
  currency: Currency;
  amountInToman?: number;
}

interface PurchaseOrder {
  id: string;
  number: number;
  status: string;
  totalAmount: number;
  totalAmountInToman?: number;
  createdAt: Date | string;
  supplier: Supplier;
  items: PurchaseOrderItem[];
  additionalCosts?: PurchaseOrderAdditionalCost[];
  arrivalAdditionalCosts?: PurchaseOrderArrivalCost[];
}

interface ExchangeRate {
  currency: string;
  rateToToman: number;
  date: Date | string;
}

interface OrderDetailProps {
  order: PurchaseOrder;
  warehouses: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; name: string; currency: string }>;
}

export function OrderDetail({ order, warehouses, accounts }: OrderDetailProps) {
  const router = useRouter();
  const [showReceiveDialog, setShowReceiveDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [showArrivalDialog, setShowArrivalDialog] = useState(false);
  const [selectedWarehouse, setSelectedWarehouse] = useState('');
  const [selectedAccount, setSelectedAccount] = useState('');
  const [arrivalAccount, setArrivalAccount] = useState('');
  const [arrivalCosts, setArrivalCosts] = useState<Array<{ title: string; amount: number; currency: Currency }>>([]);
  const [receivedItems, setReceivedItems] = useState<Record<string, { quantity: number }>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});

  useEffect(() => {
    // Load exchange rates
    getLatestExchangeRates().then((rates: ExchangeRate[]) => {
      const ratesMap: Record<string, number> = { TOMAN: 1 };
      rates.forEach((rate) => {
        if (!ratesMap[rate.currency] || new Date(rate.date) > new Date(ratesMap[rate.currency] ? rates.find((r) => r.currency === rate.currency && ratesMap[rate.currency] === Number(r.rateToToman))?.date || rate.date : rate.date)) {
          ratesMap[rate.currency] = Number(rate.rateToToman);
        }
      });
      setExchangeRates(ratesMap);
    });

    // Initialize received items
    const initialReceivedItems: Record<string, { quantity: number }> = {};
    order.items.forEach((item) => {
      const remaining = item.quantity - (item.receivedQuantity || 0);
      if (remaining > 0) {
        initialReceivedItems[item.id] = {
          quantity: 0
        };
      }
    });
    setReceivedItems(initialReceivedItems);
  }, [order]);

  const getExchangeRate = (currency: Currency): number => {
    return exchangeRates[currency] || 1;
  };

  // Calculate landed cost per unit for an item
  const calculateLandedCostPerUnit = (item: PurchaseOrderItem, order: PurchaseOrder): number => {
    // Get unit cost in Toman - ensure it's a number
    const unitCost = Number(item.unitCost || 0);
    const itemCurrency = item.currency || 'TOMAN';
    const exchangeRate = getExchangeRate(itemCurrency);
    const unitCostInToman = Number(item.unitCostInToman) || (unitCost * exchangeRate);

    // Get total additional costs (order + arrival) in Toman
    let totalAdditionalCostsInToman = 0;

    // Sum order additional costs
    if (order.additionalCosts && order.additionalCosts.length > 0) {
      order.additionalCosts.forEach((cost) => {
        const costInToman = Number(cost.amountInToman || 0);
        totalAdditionalCostsInToman += costInToman;
      });
    }

    // Sum arrival additional costs
    if (order.arrivalAdditionalCosts && order.arrivalAdditionalCosts.length > 0) {
      order.arrivalAdditionalCosts.forEach((cost) => {
        const costInToman = Number(cost.amountInToman || 0);
        totalAdditionalCostsInToman += costInToman;
      });
    }

    // Calculate total quantity of all items in the order
    const totalOrderQuantity = order.items.reduce((sum: number, i) => sum + Number(i.quantity || 0), 0);

    // Calculate additional cost per unit: total additional costs divided by total quantity
    const additionalCostPerUnit = totalOrderQuantity > 0 ? totalAdditionalCostsInToman / totalOrderQuantity : 0;

    // Landed cost per unit = unit cost + additional cost per unit
    const landedCostPerUnit = Number(unitCostInToman) + Number(additionalCostPerUnit);

    return landedCostPerUnit;
  };

  const updateReceivedItem = (itemId: string, field: string, value: number) => {
    setReceivedItems(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        [field]: value
      }
    }));
  };

  const handleReceive = async () => {
    if (!selectedWarehouse) {
      setError('لطفا انبار را انتخاب کنید');
      return;
    }

    const itemsToReceive = Object.entries(receivedItems)
      .filter(([_, data]) => data.quantity > 0)
      .map(([itemId, data]) => ({
        itemId,
        receivedQuantity: data.quantity,
      }));

    if (itemsToReceive.length === 0) {
      setError('لطفا حداقل یک آیتم را برای دریافت انتخاب کنید');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result = await receivePurchaseOrderItems(order.id, selectedWarehouse, itemsToReceive);
      if (result.success) {
        router.refresh();
        setShowReceiveDialog(false);
        setReceivedItems({});
        setSelectedWarehouse('');
      } else {
        setError(result.error || 'خطا در دریافت کالاها');
      }
    } catch (err) {
      setError('خطا در ارتباط با سرور');
    } finally {
      setLoading(false);
    }
  };

  const addArrivalCost = () => {
    setArrivalCosts([...arrivalCosts, { title: '', amount: 0, currency: 'TOMAN' }]);
  };

  const removeArrivalCost = (index: number) => {
    setArrivalCosts(arrivalCosts.filter((_, i) => i !== index));
  };

  const updateArrivalCost = (index: number, field: keyof { title: string; amount: number; currency: Currency }, value: string | number | Currency) => {
    const newCosts = [...arrivalCosts];
    newCosts[index] = { ...newCosts[index], [field]: value } as { title: string; amount: number; currency: Currency };
    setArrivalCosts(newCosts);
  };

  const handleStatusChange = async (newStatus: string) => {
    setStatusLoading(true);
    setError('');
    try {
      const result = await updatePurchaseOrderStatus(order.id, newStatus);
      if (result.success) {
        router.refresh();
      } else {
        setError(result.error || 'خطا در تغییر وضعیت');
      }
    } catch (err) {
      setError('خطا در ارتباط با سرور');
    } finally {
      setStatusLoading(false);
    }
  };

  const handlePayment = async () => {
    if (!selectedAccount) {
      setError('لطفا حساب را انتخاب کنید');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await recordPurchasePayment(order.id, selectedAccount);
      if (result.success) {
        router.refresh();
        setShowPaymentDialog(false);
        setSelectedAccount('');
      } else {
        setError(result.error || 'خطا در ثبت پرداخت');
      }
    } catch (err) {
      setError('خطا در ارتباط با سرور');
    } finally {
      setLoading(false);
    }
  };

  const handleArrival = async () => {
    if (!arrivalAccount) {
      setError('لطفا حساب را انتخاب کنید');
      return;
    }

    const validCosts = arrivalCosts.filter(cost => cost.title && cost.amount > 0);
    if (validCosts.length === 0) {
      setError('لطفا حداقل یک هزینه اضافی وارد کنید');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await recordArrival(order.id, validCosts, arrivalAccount);
      if (result.success) {
        router.refresh();
        setShowArrivalDialog(false);
        setArrivalCosts([]);
        setArrivalAccount('');
      } else {
        setError(result.error || 'خطا در ثبت رسیدن به مقصد');
      }
    } catch (err) {
      setError('خطا در ارتباط با سرور');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      'DRAFT': { label: 'پیش‌نویس', variant: 'outline' },
      'PENDING_PAYMENT': { label: 'منتظر پرداخت', variant: 'secondary' },
      'PAID': { label: 'پرداخت شده', variant: 'default' },
      'IN_PRODUCTION': { label: 'در حال تولید', variant: 'default' },
      'ARRIVED': { label: 'رسیده به مقصد', variant: 'default' },
      'PARTIALLY_RECEIVED': { label: 'نیمه دریافت شده', variant: 'default' },
      'RECEIVED': { label: 'دریافت شده', variant: 'default' },
      'CANCELLED': { label: 'لغو شده', variant: 'destructive' },
    };
    const statusInfo = statusMap[status] || { label: status, variant: 'secondary' };
    return <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>;
  };

  const getWorkflowSteps = () => {
    const steps = [
      { key: 'DRAFT', label: 'ثبت سفارش', icon: '📝' },
      { key: 'PENDING_PAYMENT', label: 'منتظر پرداخت', icon: '⏳' },
      { key: 'PAID', label: 'پرداخت شده', icon: '💳' },
      { key: 'IN_PRODUCTION', label: 'در حال تولید', icon: '🏭' },
      { key: 'ARRIVED', label: 'رسیده به مقصد', icon: '🚚' },
      { key: 'RECEIVED', label: 'دریافت شده', icon: '✅' },
    ];

    const currentIndex = steps.findIndex(s => s.key === order.status);
    return steps.map((step, index) => ({
      ...step,
      completed: index <= currentIndex,
      current: index === currentIndex,
    }));
  };

  const getCurrencyLabel = (currency: string) => {
    const labels: Record<string, string> = {
      'TOMAN': 'تومان',
      'USD': 'دلار',
      'EUR': 'یورو',
      'CNY': 'یوان',
    };
    return labels[currency] || currency;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">سفارش خرید #{order.number}</h1>
          <p className="text-muted-foreground mt-1">
            تامین‌کننده: {order.supplier.name} | تاریخ: {formatJalaliDate(order.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {getStatusBadge(order.status)}
        </div>
      </div>

      {/* Workflow Steps */}
      <Card>
        <CardHeader>
          <CardTitle>مراحل سفارش</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between overflow-x-auto pb-4">
            {getWorkflowSteps().map((step, index) => (
              <div key={step.key} className="flex items-center flex-1 min-w-0">
                <div className="flex flex-col items-center flex-1 min-w-0">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl mb-2 ${
                    step.completed ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}>
                    {step.icon}
                  </div>
                  <div className={`text-xs text-center ${step.current ? 'font-bold' : ''}`}>
                    {step.label}
                  </div>
                </div>
                {index < getWorkflowSteps().length - 1 && (
                  <div className={`flex-1 h-0.5 mx-2 ${step.completed ? 'bg-primary' : 'bg-muted'}`} />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      {order.status !== 'RECEIVED' && order.status !== 'CANCELLED' && (
        <Card>
          <CardHeader>
            <CardTitle>عملیات</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {order.status === 'DRAFT' && (
                <Button 
                  onClick={() => handleStatusChange('PENDING_PAYMENT')}
                  disabled={statusLoading}
                >
                  <ArrowRight className="w-4 h-4 ml-2" />
                  ارسال برای پرداخت
                </Button>
              )}
              {order.status === 'PENDING_PAYMENT' && (
                <Button 
                  onClick={() => setShowPaymentDialog(true)}
                  variant="default"
                >
                  <CreditCard className="w-4 h-4 ml-2" />
                  ثبت پرداخت
                </Button>
              )}
              {order.status === 'PAID' && (
                <Button 
                  onClick={() => handleStatusChange('IN_PRODUCTION')}
                  disabled={statusLoading}
                >
                  <Factory className="w-4 h-4 ml-2" />
                  شروع تولید
                </Button>
              )}
              {order.status === 'IN_PRODUCTION' && (
                <Button 
                  onClick={() => setShowArrivalDialog(true)}
                  variant="default"
                >
                  <Truck className="w-4 h-4 ml-2" />
                  ثبت رسیدن به مقصد
                </Button>
              )}
              {order.status === 'ARRIVED' && (
                <Button 
                  onClick={() => setShowReceiveDialog(true)}
                  variant="default"
                >
                  <Package className="w-4 h-4 ml-2" />
                  دریافت کالا
                </Button>
              )}
              {order.status !== 'RECEIVED' && (
                <Button 
                  onClick={() => handleStatusChange('CANCELLED')}
                  variant="destructive"
                  disabled={statusLoading}
                >
                  لغو سفارش
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">مبلغ کل</CardTitle>
          </CardHeader>
          <CardContent>
            {order.totalAmountInToman && (
              <div className="text-2xl font-bold">
                {Number(order.totalAmountInToman).toLocaleString('fa-IR')} تومان
              </div>
            )}
            {order.items && order.items.length > 0 && (
              <div className="text-sm text-muted-foreground mt-1">
                {Number(order.totalAmount).toLocaleString('fa-IR')} {getCurrencyLabel(order.items[0]?.currency || 'TOMAN')}
              </div>
            )}
          </CardContent>
        </Card>
        {order.additionalCosts && order.additionalCosts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">هزینه‌های اضافی</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {order.additionalCosts.map((cost, index) => (
                  <div key={index} className="flex justify-between items-center">
                    <span className="text-sm">{cost.title}:</span>
                    <div className="text-right">
                      <div className="text-sm font-medium">
                        {Number(cost.amount).toLocaleString('fa-IR')} {getCurrencyLabel(cost.currency)}
                      </div>
                      {cost.amountInToman && (
                        <div className="text-xs text-muted-foreground">
                          {Number(cost.amountInToman).toLocaleString('fa-IR')} تومان
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">وضعیت</CardTitle>
          </CardHeader>
          <CardContent>
            {getStatusBadge(order.status)}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>اقلام سفارش</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">محصول</TableHead>
                <TableHead className="text-right">تعداد</TableHead>
                <TableHead className="text-right">دریافت شده</TableHead>
                <TableHead className="text-right">باقیمانده</TableHead>
                <TableHead className="text-right">قیمت واحد</TableHead>
                <TableHead className="text-right">ارز</TableHead>
                <TableHead className="text-right">قیمت واحد (تومان)</TableHead>
                <TableHead className="text-right">جمع (تومان)</TableHead>
                <TableHead className="text-right">قیمت تمام شده (هر واحد)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.items.map((item) => {
                const receivedQty = item.receivedQuantity || 0;
                const remaining = item.quantity - receivedQty;
                // Ensure unitCostInToman is a number, not Decimal or string
                const unitCostInToman = Number(item.unitCostInToman) || (Number(item.unitCost) * getExchangeRate(item.currency));
                const totalInToman = Number(item.quantity) * unitCostInToman;

                // Calculate landed cost per unit
                const landedCostPerUnit = calculateLandedCostPerUnit(item, order);

                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.product.name}</TableCell>
                    <TableCell>{item.quantity}</TableCell>
                    <TableCell>
                      <Badge variant={receivedQty > 0 ? 'default' : 'outline'}>
                        {receivedQty}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={remaining > 0 ? 'secondary' : 'default'}>
                        {remaining}
                      </Badge>
                    </TableCell>
                    <TableCell>{Number(item.unitCost).toLocaleString('fa-IR')}</TableCell>
                    <TableCell>{getCurrencyLabel(item.currency)}</TableCell>
                    <TableCell>{unitCostInToman.toLocaleString('fa-IR')}</TableCell>
                    <TableCell>{totalInToman.toLocaleString('fa-IR')}</TableCell>
                    <TableCell>
                      <span className="font-medium">{landedCostPerUnit.toLocaleString('fa-IR')} تومان</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showReceiveDialog} onOpenChange={setShowReceiveDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>دریافت کالا</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label>انبار *</Label>
              <Select value={selectedWarehouse} onValueChange={setSelectedWarehouse} required>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب انبار" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-4">
              <Label>اقلام دریافت شده</Label>
              <div className="border rounded-lg divide-y">
                {order.items
                  .filter((item) => {
                    const receivedQty = item.receivedQuantity || 0;
                    return item.quantity - receivedQty > 0;
                  })
                  .map((item) => {
                    const receivedQty = item.receivedQuantity || 0;
                    const remaining = item.quantity - receivedQty;
                    const receivedData = receivedItems[item.id] || { quantity: 0 };

                    return (
                      <div key={item.id} className="p-4 space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium">{item.product.name}</div>
                            <div className="text-sm text-muted-foreground">
                              سفارش: {item.quantity} | دریافت شده: {receivedQty} | باقیمانده: {remaining}
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>تعداد دریافت شده *</Label>
                            <Input
                              type="number"
                              min="1"
                              max={remaining}
                              value={receivedData.quantity}
                              onChange={(e) => updateReceivedItem(item.id, 'quantity', Number(e.target.value))}
                              placeholder="0"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-muted-foreground">قیمت تمام شده (تخمینی)</Label>
                            <div className="text-sm font-medium pt-2">
                              {receivedData.quantity > 0 ? (() => {
                                const landedCostPerUnit = calculateLandedCostPerUnit(item, order);
                                return (
                                  <>
                                    {landedCostPerUnit.toLocaleString('fa-IR')} تومان
                                    <span className="text-xs text-muted-foreground block">برای هر واحد</span>
                                  </>
                                );
                              })() : (
                                '-'
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReceiveDialog(false)}>
              انصراف
            </Button>
            <Button onClick={handleReceive} disabled={loading}>
              {loading ? 'در حال ثبت...' : 'تایید و دریافت'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Dialog */}
      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ثبت پرداخت</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label>حساب پرداخت *</Label>
              <Select value={selectedAccount} onValueChange={setSelectedAccount} required>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب حساب" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.name} ({acc.currency})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="text-sm text-muted-foreground">
              مبلغ کل: {order.totalAmountInToman ? Number(order.totalAmountInToman).toLocaleString('fa-IR') : '0'} تومان
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>
              انصراف
            </Button>
            <Button onClick={handlePayment} disabled={loading}>
              {loading ? 'در حال ثبت...' : 'ثبت پرداخت'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Arrival Dialog */}
      <Dialog open={showArrivalDialog} onOpenChange={setShowArrivalDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>ثبت رسیدن به مقصد</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label>حساب پرداخت هزینه‌ها *</Label>
              <Select value={arrivalAccount} onValueChange={setArrivalAccount} required>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب حساب" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.name} ({acc.currency})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <Label>هزینه‌های اضافی</Label>
                <Button type="button" variant="outline" size="sm" onClick={addArrivalCost}>
                  <Plus className="w-4 h-4 ml-2" />
                  افزودن هزینه
                </Button>
              </div>
              {arrivalCosts.map((cost, index) => (
                <div key={index} className="grid grid-cols-12 gap-4 items-end border p-4 rounded-lg bg-muted/20">
                  <div className="col-span-12 md:col-span-4 space-y-2">
                    <Label>عنوان</Label>
                    <Input
                      value={cost.title}
                      onChange={(e) => updateArrivalCost(index, 'title', e.target.value)}
                      placeholder="مثال: حمل و نقل داخلی"
                      required
                    />
                  </div>
                  <div className="col-span-6 md:col-span-3 space-y-2">
                    <Label>مبلغ</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={cost.amount}
                      onChange={(e) => updateArrivalCost(index, 'amount', Number(e.target.value))}
                      placeholder="0"
                      required
                    />
                  </div>
                  <div className="col-span-6 md:col-span-3 space-y-2">
                    <Label>ارز</Label>
                    <Select
                      value={cost.currency}
                      onValueChange={(val: Currency) => updateArrivalCost(index, 'currency', val)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="TOMAN">تومان</SelectItem>
                        <SelectItem value="USD">دلار</SelectItem>
                        <SelectItem value="EUR">یورو</SelectItem>
                        <SelectItem value="CNY">یوان</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-12 md:col-span-2 flex justify-end">
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      onClick={() => removeArrivalCost(index)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowArrivalDialog(false)}>
              انصراف
            </Button>
            <Button onClick={handleArrival} disabled={loading}>
              {loading ? 'در حال ثبت...' : 'ثبت رسیدن به مقصد'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Arrival Costs Display */}
      {order.arrivalAdditionalCosts && order.arrivalAdditionalCosts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>هزینه‌های رسیدن به مقصد</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {order.arrivalAdditionalCosts.map((cost, index) => (
                <div key={index} className="flex justify-between items-center">
                  <span className="text-sm">{cost.title}:</span>
                  <div className="text-right">
                    <div className="text-sm font-medium">
                      {Number(cost.amount).toLocaleString('fa-IR')} {getCurrencyLabel(cost.currency)}
                    </div>
                    {cost.amountInToman && (
                      <div className="text-xs text-muted-foreground">
                        {Number(cost.amountInToman).toLocaleString('fa-IR')} تومان
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

