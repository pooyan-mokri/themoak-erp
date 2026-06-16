'use client';

import { useState, useMemo } from 'react';
import { transferStockBatch } from '@/actions/consignment';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface Warehouse {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
}

interface TransferFormProps {
  warehouses: Warehouse[];
  products: Product[];
}

interface LineItem {
  productId: string;
  quantity: number;
}

export function TransferForm({ warehouses, products }: TransferFormProps) {
  const [sourceWarehouseId, setSourceWarehouseId] = useState('');
  const [targetWarehouseId, setTargetWarehouseId] = useState('');
  const [items, setItems] = useState<LineItem[]>([]);
  const [pickProduct, setPickProduct] = useState('');
  const [pickQty, setPickQty] = useState('1');
  const [submitting, setSubmitting] = useState(false);

  const productMap = useMemo(() => {
    const m = new Map<string, string>();
    products.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [products]);

  const addItem = () => {
    const qty = Number(pickQty);
    if (!pickProduct) {
      toast.error('یک محصول انتخاب کنید.');
      return;
    }
    if (!qty || qty <= 0) {
      toast.error('تعداد باید بیشتر از صفر باشد.');
      return;
    }
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === pickProduct);
      if (existing) {
        return prev.map((i) => (i.productId === pickProduct ? { ...i, quantity: i.quantity + qty } : i));
      }
      return [...prev, { productId: pickProduct, quantity: qty }];
    });
    setPickProduct('');
    setPickQty('1');
  };

  const updateQty = (productId: string, qty: number) => {
    setItems((prev) => prev.map((i) => (i.productId === productId ? { ...i, quantity: qty } : i)));
  };

  const removeItem = (productId: string) => {
    setItems((prev) => prev.filter((i) => i.productId !== productId));
  };

  const handleTransfer = async () => {
    if (!sourceWarehouseId || !targetWarehouseId) {
      toast.error('انبار مبدا و مقصد را انتخاب کنید.');
      return;
    }
    if (sourceWarehouseId === targetWarehouseId) {
      toast.error('انبار مبدا و مقصد نمی‌توانند یکسان باشند.');
      return;
    }
    if (items.length === 0) {
      toast.error('حداقل یک کالا به لیست اضافه کنید.');
      return;
    }

    setSubmitting(true);
    const result = await transferStockBatch({
      sourceWarehouseId,
      targetWarehouseId,
      items,
    });
    setSubmitting(false);

    if (result.success) {
      toast.success(result.message);
      setItems([]);
    } else {
      toast.error(result.message || 'خطا در انتقال موجودی');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>انتقال موجودی به همکار</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>انبار مبدا</Label>
            <Select value={sourceWarehouseId} onValueChange={setSourceWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder="انتخاب انبار مبدا" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>انبار مقصد (همکار)</Label>
            <Select value={targetWarehouseId} onValueChange={setTargetWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder="انتخاب انبار مقصد" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Add a line */}
        <div className="flex flex-col sm:flex-row gap-2 items-end border-t pt-4">
          <div className="flex-1 space-y-2 w-full">
            <Label>محصول</Label>
            <Select value={pickProduct} onValueChange={setPickProduct}>
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
          <div className="w-full sm:w-28 space-y-2">
            <Label>تعداد</Label>
            <Input
              type="number"
              min="1"
              value={pickQty}
              onChange={(e) => setPickQty(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
            />
          </div>
          <Button type="button" variant="secondary" onClick={addItem} className="w-full sm:w-auto">
            <Plus className="h-4 w-4 ml-1" /> افزودن
          </Button>
        </div>

        {/* Items list */}
        {items.length > 0 && (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">محصول</TableHead>
                  <TableHead className="text-right w-[120px]">تعداد</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.productId}>
                    <TableCell className="font-medium">
                      {productMap.get(item.productId) ?? item.productId}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateQty(item.productId, Number(e.target.value))}
                        className="h-8 w-24"
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => removeItem(item.productId)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <Button
          type="button"
          className="w-full"
          onClick={handleTransfer}
          disabled={submitting || items.length === 0}
        >
          {submitting ? 'در حال انتقال...' : `انتقال به همکار${items.length > 0 ? ` (${items.length} کالا)` : ''}`}
        </Button>
      </CardContent>
    </Card>
  );
}
