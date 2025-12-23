'use client';

import { useState, useEffect } from 'react';
import { createPurchaseOrder, createSupplier } from '@/actions/supplier';
import { getLatestExchangeRates } from '@/actions/accounting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Product {
  id: string;
  name: string;
}

interface Supplier {
  id: string;
  name: string;
}

interface OrderFormProps {
  suppliers: Supplier[];
  products: Product[];
}

type Currency = 'TOMAN' | 'USD' | 'EUR' | 'CNY';

export function OrderForm({ suppliers, products }: OrderFormProps) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState('');
  const [items, setItems] = useState<Array<{ productId: string; quantity: number; unitCost: number; currency: Currency }>>([
    { productId: '', quantity: 1, unitCost: 0, currency: 'TOMAN' }
  ]);
  const [additionalCosts, setAdditionalCosts] = useState<Array<{ title: string; amount: number; currency: Currency }>>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});
  const [showSupplierDialog, setShowSupplierDialog] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierPhone, setNewSupplierPhone] = useState('');
  const [newSupplierEmail, setNewSupplierEmail] = useState('');
  const [newSupplierAddress, setNewSupplierAddress] = useState('');
  const [creatingSupplier, setCreatingSupplier] = useState(false);

  useEffect(() => {
    // Load exchange rates
    getLatestExchangeRates().then((rates: any[]) => {
      const ratesMap: Record<string, number> = { TOMAN: 1 };
      // Group by currency and get the latest rate for each
      const currencyGroups: Record<string, any[]> = {};
      rates.forEach((rate: any) => {
        if (!currencyGroups[rate.currency]) {
          currencyGroups[rate.currency] = [];
        }
        currencyGroups[rate.currency].push(rate);
      });
      
      // Get the latest rate for each currency
      Object.keys(currencyGroups).forEach((currency) => {
        const currencyRates = currencyGroups[currency];
        const latestRate = currencyRates.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
        ratesMap[currency] = Number(latestRate.rateToToman);
      });
      
      setExchangeRates(ratesMap);
    });
  }, []);

  const getExchangeRate = (currency: Currency): number => {
    return exchangeRates[currency] || 1;
  };

  const addItem = () => {
    setItems([...items, { productId: '', quantity: 1, unitCost: 0, currency: 'TOMAN' }]);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: string, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const addAdditionalCost = () => {
    setAdditionalCosts([...additionalCosts, { title: '', amount: 0, currency: 'TOMAN' }]);
  };

  const removeAdditionalCost = (index: number) => {
    setAdditionalCosts(additionalCosts.filter((_, i) => i !== index));
  };

  const updateAdditionalCost = (index: number, field: string, value: any) => {
    const newCosts = [...additionalCosts];
    newCosts[index] = { ...newCosts[index], [field]: value };
    setAdditionalCosts(newCosts);
  };

  const handleCreateSupplier = async () => {
    if (!newSupplierName.trim()) {
      setError('نام تامین‌کننده الزامی است');
      return;
    }

    setCreatingSupplier(true);
    try {
      const formData = new FormData();
      formData.append('name', newSupplierName);
      if (newSupplierPhone) formData.append('phone', newSupplierPhone);
      if (newSupplierEmail) formData.append('email', newSupplierEmail);
      if (newSupplierAddress) formData.append('address', newSupplierAddress);

      const result = await createSupplier(null, formData);
      if (result.success) {
        // Refresh suppliers list - in a real app, we'd update the list
        router.refresh();
        setShowSupplierDialog(false);
        setNewSupplierName('');
        setNewSupplierPhone('');
        setNewSupplierEmail('');
        setNewSupplierAddress('');
        // Note: In a real app, we'd need to get the new supplier ID
        // For now, user needs to refresh the page
      } else {
        setError(result.error || 'خطا در ایجاد تامین‌کننده');
      }
    } catch (err) {
      setError('خطا در ارتباط با سرور');
    } finally {
      setCreatingSupplier(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!supplierId) {
      setError('لطفا تامین‌کننده را انتخاب کنید');
      setLoading(false);
      return;
    }

    // Validate items
    const validItems = items.filter(item => item.productId && item.quantity > 0 && item.unitCost >= 0);
    if (validItems.length === 0) {
      setError('لطفا حداقل یک محصول معتبر اضافه کنید');
      setLoading(false);
      return;
    }

    try {
      const orderData = {
        supplierId,
        items: validItems.map(item => ({
          productId: item.productId,
          quantity: Number(item.quantity),
          unitCost: Number(item.unitCost),
          currency: item.currency || 'TOMAN', // Ensure currency is always set
        })),
        additionalCosts: additionalCosts.length > 0 ? additionalCosts
          .filter(cost => cost.title && cost.amount > 0) // Filter valid costs
          .map(cost => ({
            title: cost.title,
            amount: Number(cost.amount),
            currency: cost.currency || 'TOMAN',
          })) : undefined,
      };

      console.log('Submitting order data:', JSON.stringify(orderData, null, 2));

      const result = await createPurchaseOrder(orderData);

      if (result.success) {
        router.push('/dashboard/suppliers/orders');
      } else {
        const errorMessage = result.error || 'خطا در ثبت سفارش';
        console.error('Purchase order creation failed:', errorMessage);
        setError(errorMessage);
      }
    } catch (err) {
      console.error('Error in handleSubmit:', err);
      setError(err instanceof Error ? err.message : 'خطا در ارتباط با سرور');
    } finally {
      setLoading(false);
    }
  };

  // Calculate totals
  const calculateTotals = () => {
    let totalInToman = 0;
    const totalsByCurrency: Record<string, number> = {};

    items.forEach(item => {
      if (item.productId && item.quantity > 0 && item.unitCost >= 0) {
        const exchangeRate = getExchangeRate(item.currency);
        const itemTotalInToman = item.quantity * item.unitCost * exchangeRate;
        totalInToman += itemTotalInToman;

        if (!totalsByCurrency[item.currency]) {
          totalsByCurrency[item.currency] = 0;
        }
        totalsByCurrency[item.currency] += item.quantity * item.unitCost;
      }
    });

    // Add additional costs
    additionalCosts.forEach(cost => {
      if (cost.title && cost.amount > 0) {
        const exchangeRate = getExchangeRate(cost.currency);
        const costInToman = cost.amount * exchangeRate;
        totalInToman += costInToman;

        if (!totalsByCurrency[cost.currency]) {
          totalsByCurrency[cost.currency] = 0;
        }
        totalsByCurrency[cost.currency] += cost.amount;
      }
    });

    return { totalInToman, totalsByCurrency };
  };

  const { totalInToman, totalsByCurrency } = calculateTotals();

  return (
    <Card>
      <CardHeader>
        <CardTitle>ثبت سفارش خرید جدید</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>تامین‌کننده *</Label>
              <Dialog open={showSupplierDialog} onOpenChange={setShowSupplierDialog}>
                <DialogTrigger asChild>
                  <Button type="button" variant="outline" size="sm">
                    <Plus className="w-4 h-4 ml-2" />
                    افزودن تامین‌کننده جدید
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>افزودن تامین‌کننده جدید</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 mt-4">
                    <div className="space-y-2">
                      <Label>نام *</Label>
                      <Input
                        value={newSupplierName}
                        onChange={(e) => setNewSupplierName(e.target.value)}
                        placeholder="نام تامین‌کننده"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>تلفن</Label>
                      <Input
                        value={newSupplierPhone}
                        onChange={(e) => setNewSupplierPhone(e.target.value)}
                        placeholder="شماره تماس"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>ایمیل</Label>
                      <Input
                        type="email"
                        value={newSupplierEmail}
                        onChange={(e) => setNewSupplierEmail(e.target.value)}
                        placeholder="ایمیل"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>آدرس</Label>
                      <Input
                        value={newSupplierAddress}
                        onChange={(e) => setNewSupplierAddress(e.target.value)}
                        placeholder="آدرس"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowSupplierDialog(false)}
                      >
                        انصراف
                      </Button>
                      <Button
                        type="button"
                        onClick={handleCreateSupplier}
                        disabled={creatingSupplier}
                      >
                        {creatingSupplier ? 'در حال ایجاد...' : 'ایجاد'}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <Select value={supplierId} onValueChange={setSupplierId} required>
              <SelectTrigger>
                <SelectValue placeholder="انتخاب تامین‌کننده" />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <Label>اقلام سفارش</Label>
              <Button type="button" variant="outline" size="sm" onClick={addItem}>
                <Plus className="w-4 h-4 ml-2" />
                افزودن محصول
              </Button>
            </div>

            {items.map((item, index) => (
              <div key={index} className="grid grid-cols-12 gap-4 items-end border p-4 rounded-lg bg-muted/20">
                <div className="col-span-12 md:col-span-4 space-y-2">
                  <Label>محصول</Label>
                  <Select 
                    value={item.productId} 
                    onValueChange={(val: string) => updateItem(index, 'productId', val)}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="انتخاب محصول" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-6 md:col-span-2 space-y-2">
                  <Label>تعداد</Label>
                  <Input 
                    type="number" 
                    min="1"
                    value={item.quantity}
                    onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                    required
                  />
                </div>
                <div className="col-span-6 md:col-span-2 space-y-2">
                  <Label>قیمت واحد</Label>
                  <Input 
                    type="number" 
                    min="0"
                    step="0.01"
                    value={item.unitCost}
                    onChange={(e) => updateItem(index, 'unitCost', e.target.value)}
                    required
                  />
                </div>
                <div className="col-span-6 md:col-span-2 space-y-2">
                  <Label>ارز</Label>
                  <Select
                    value={item.currency}
                    onValueChange={(val: Currency) => updateItem(index, 'currency', val)}
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
                <div className="col-span-6 md:col-span-2 space-y-2">
                  <Label className="text-muted-foreground">جمع (تومان)</Label>
                  <div className="text-sm font-medium pt-2">
                    {item.productId && item.quantity > 0 && item.unitCost >= 0
                      ? (item.quantity * item.unitCost * getExchangeRate(item.currency)).toLocaleString('fa-IR')
                      : '0'}
                  </div>
                </div>
                <div className="col-span-12 md:col-span-1 flex justify-end">
                  <Button 
                    type="button" 
                    variant="destructive" 
                    size="icon"
                    onClick={() => removeItem(index)}
                    disabled={items.length === 1}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-4 border-t pt-4">
            <div className="flex justify-between items-center">
              <Label>هزینه‌های اضافی</Label>
              <Button type="button" variant="outline" size="sm" onClick={addAdditionalCost}>
                <Plus className="w-4 h-4 ml-2" />
                افزودن هزینه
              </Button>
            </div>

            {additionalCosts.map((cost, index) => (
              <div key={index} className="grid grid-cols-12 gap-4 items-end border p-4 rounded-lg bg-muted/20">
                <div className="col-span-12 md:col-span-4 space-y-2">
                  <Label>عنوان</Label>
                  <Input
                    value={cost.title}
                    onChange={(e) => updateAdditionalCost(index, 'title', e.target.value)}
                    placeholder="مثال: حمل و نقل"
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
                    onChange={(e) => updateAdditionalCost(index, 'amount', Number(e.target.value))}
                    placeholder="0"
                    required
                  />
                </div>
                <div className="col-span-6 md:col-span-3 space-y-2">
                  <Label>ارز</Label>
                  <Select
                    value={cost.currency}
                    onValueChange={(val: Currency) => updateAdditionalCost(index, 'currency', val)}
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
                    onClick={() => removeAdditionalCost(index)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-4 border-t pt-4">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">جمع کل به ارز:</span>
                <div className="text-right space-y-1">
                  {Object.entries(totalsByCurrency).map(([currency, total]) => (
                    <div key={currency} className="text-sm font-medium">
                      {currency === 'TOMAN' ? 'تومان' : currency}: {total.toLocaleString('fa-IR')}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-between items-center pt-2 border-t">
                <span className="text-lg font-bold">جمع کل به تومان:</span>
                <span className="text-lg font-bold">{totalInToman.toLocaleString('fa-IR')} تومان</span>
              </div>
              {Object.keys(totalsByCurrency).length > 0 && (
                <div className="flex justify-between items-center pt-2">
                  <span className="text-sm text-muted-foreground">جمع کل به ارز اصلی:</span>
                  <div className="text-right space-y-1">
                    {Object.entries(totalsByCurrency).map(([currency, total]) => {
                      const exchangeRate = getExchangeRate(currency as Currency);
                      const totalInCurrency = totalInToman / exchangeRate;
                      return (
                        <div key={currency} className="text-sm font-medium">
                          {currency === 'TOMAN' ? 'تومان' : currency}: {totalInCurrency.toLocaleString('fa-IR')}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t">
            <Button type="submit" disabled={loading}>
              {loading ? 'در حال ثبت...' : 'ثبت سفارش'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
