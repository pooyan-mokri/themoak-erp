'use client';

import { useState, useTransition } from 'react';
import { returnConsignmentStock } from '@/actions/consignment';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

interface Warehouse {
  id: string;
  name: string;
  isVirtual?: boolean;
}

interface Product {
  id: string;
  name: string;
  sku: string;
}

interface ReturnFormProps {
  partners: Warehouse[]; // virtual warehouses
  targetWarehouses: Warehouse[]; // real warehouses
  products: Product[];
}

interface RowItem {
  productId: string;
  quantity: string;
}

export function ReturnForm({ partners, targetWarehouses, products }: ReturnFormProps) {
  const [partnerWarehouseId, setPartnerWarehouseId] = useState('');
  const [targetWarehouseId, setTargetWarehouseId] = useState('');
  const [items, setItems] = useState<RowItem[]>([{ productId: '', quantity: '1' }]);
  const [isPending, startTransition] = useTransition();

  const addRow = () => setItems([...items, { productId: '', quantity: '1' }]);
  const removeRow = (idx: number) => setItems(items.filter((_, i) => i !== idx));
  const updateRow = (idx: number, patch: Partial<RowItem>) =>
    setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const handleSubmit = () => {
    if (!partnerWarehouseId) {
      toast.error('لطفاً انبار همکار را انتخاب کنید');
      return;
    }
    if (!targetWarehouseId) {
      toast.error('لطفاً انبار مقصد را انتخاب کنید');
      return;
    }
    const cleaned = items
      .filter((it) => it.productId && Number(it.quantity) > 0)
      .map((it) => ({ productId: it.productId, quantity: Number(it.quantity) }));
    if (cleaned.length === 0) {
      toast.error('حداقل یک آیتم با اطلاعات کامل وارد کنید');
      return;
    }
    startTransition(async () => {
      const result = await returnConsignmentStock({
        partnerWarehouseId,
        targetWarehouseId,
        items: cleaned,
      });
      if (result.success) {
        toast.success(result.message);
        setItems([{ productId: '', quantity: '1' }]);
      } else {
        toast.error(result.message || 'خطا در ثبت برگشت کالا');
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>برگشت کالای فروش‌نرفته امانی</CardTitle>
        <CardDescription>
          کالای فروش‌نرفته را از انبار همکار به انبار اصلی برگردانید. این عملیات اثر مالی ندارد.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>انبار همکار (مبدا)</Label>
            <Select value={partnerWarehouseId} onValueChange={setPartnerWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder="انتخاب همکار" />
              </SelectTrigger>
              <SelectContent>
                {partners.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>انبار مقصد (اصلی)</Label>
            <Select value={targetWarehouseId} onValueChange={setTargetWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder="انتخاب انبار مقصد" />
              </SelectTrigger>
              <SelectContent>
                {targetWarehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>کالاهای برگشتی</Label>
          {items.map((item, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-8">
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
              <div className="col-span-3">
                <Input
                  type="number"
                  min="1"
                  placeholder="تعداد"
                  value={item.quantity}
                  onChange={(e) => updateRow(idx, { quantity: e.target.value })}
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
      </CardContent>
      <CardFooter className="flex justify-end">
        <Button onClick={handleSubmit} disabled={isPending}>
          {isPending ? 'در حال ثبت...' : 'ثبت برگشت کالا'}
        </Button>
      </CardFooter>
    </Card>
  );
}
