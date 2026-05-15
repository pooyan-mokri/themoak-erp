'use client';

import { useState, useTransition } from 'react';
import { recordConsignmentSales } from '@/actions/consignment';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface Partner {
  id: string;
  name: string;
  customer?: { id: string; name: string; commissionRate?: number };
}

interface Product {
  id: string;
  name: string;
  sku: string;
}

interface SettlementFormProps {
  partners: Partner[];
  products: Product[];
}

interface RowItem {
  productId: string;
  quantity: string;
  unitPrice: string;
}

export function SettlementForm({ partners, products }: SettlementFormProps) {
  const [partnerWarehouseId, setPartnerWarehouseId] = useState('');
  const [saleDate, setSaleDate] = useState<Date>(new Date());
  const [items, setItems] = useState<RowItem[]>([
    { productId: '', quantity: '1', unitPrice: '' },
  ]);
  const [isPending, startTransition] = useTransition();

  const selectedPartner = partners.find((p) => p.id === partnerWarehouseId);
  const commissionRate = selectedPartner?.customer?.commissionRate ?? 0;

  const addRow = () =>
    setItems([...items, { productId: '', quantity: '1', unitPrice: '' }]);
  const removeRow = (idx: number) =>
    setItems(items.filter((_, i) => i !== idx));
  const updateRow = (idx: number, patch: Partial<RowItem>) =>
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  // Live totals
  const grossTotal = items.reduce(
    (s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
    0,
  );
  const commissionAmount = (grossTotal * commissionRate) / 100;
  const netAmount = grossTotal - commissionAmount;

  const handleSubmit = () => {
    if (!partnerWarehouseId) {
      toast.error('لطفاً همکار را انتخاب کنید');
      return;
    }
    const cleaned = items
      .filter((it) => it.productId && Number(it.quantity) > 0 && Number(it.unitPrice) >= 0)
      .map((it) => ({
        productId: it.productId,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice),
      }));
    if (cleaned.length === 0) {
      toast.error('حداقل یک آیتم با اطلاعات کامل وارد کنید');
      return;
    }
    startTransition(async () => {
      const result = await recordConsignmentSales({
        partnerWarehouseId,
        saleDate: saleDate.toISOString().slice(0, 10),
        items: cleaned,
      });
      if (result.success) {
        toast.success(result.message);
        setItems([{ productId: '', quantity: '1', unitPrice: '' }]);
      } else {
        toast.error(result.message || 'خطا در ثبت فروش');
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>ثبت فروش امانی</CardTitle>
        <CardDescription>
          گزارش فروش هفتگی/ماهانه همکار — همه آیتم‌ها در یک فاکتور ثبت می‌شوند.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>همکار</Label>
            <Select value={partnerWarehouseId} onValueChange={setPartnerWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder="انتخاب همکار" />
              </SelectTrigger>
              <SelectContent>
                {partners.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.customer?.name || p.name}
                    {p.customer?.commissionRate
                      ? ` (کمیسیون ${p.customer.commissionRate}%)`
                      : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <JalaliDatePicker
            name="saleDate"
            label="تاریخ گزارش فروش"
            defaultValue={saleDate}
            onChange={(d) => d && setSaleDate(d)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label>آیتم‌های فروخته شده</Label>
          {items.map((item, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-6">
                <Select
                  value={item.productId}
                  onValueChange={(v) => updateRow(idx, { productId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="محصول" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Input
                  type="number"
                  min="1"
                  placeholder="تعداد"
                  value={item.quantity}
                  onChange={(e) => updateRow(idx, { quantity: e.target.value })}
                />
              </div>
              <div className="col-span-3">
                <Input
                  type="number"
                  min="0"
                  placeholder="قیمت واحد"
                  value={item.unitPrice}
                  onChange={(e) => updateRow(idx, { unitPrice: e.target.value })}
                />
              </div>
              <div className="col-span-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeRow(idx)}
                  disabled={items.length === 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="h-4 w-4 ml-1" />
            افزودن آیتم
          </Button>
        </div>

        {grossTotal > 0 && (
          <div className="rounded-lg border p-4 bg-muted/30 space-y-1 text-sm">
            <div className="flex justify-between">
              <span>مبلغ کل فروش (ناخالص):</span>
              <span className="font-medium">{grossTotal.toLocaleString('fa-IR')} تومان</span>
            </div>
            {commissionRate > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>سهم همکار (کمیسیون {commissionRate}% — قبلاً کسر شده):</span>
                <span>{commissionAmount.toLocaleString('fa-IR')} تومان</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-1 mt-1 font-bold text-base">
              <span>سهم ما (مبلغ قابل دریافت):</span>
              <span className="text-green-700">
                {netAmount.toLocaleString('fa-IR')} تومان
              </span>
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-end">
        <Button onClick={handleSubmit} disabled={isPending}>
          {isPending ? 'در حال ثبت...' : 'ثبت فاکتور فروش'}
        </Button>
      </CardFooter>
    </Card>
  );
}
