'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { adjustStock } from '@/actions/inventory';
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
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { TagInput } from '@/components/ui/tag-input';

interface Product {
  id: string;
  name: string;
  sku: string;
}

interface Warehouse {
  id: string;
  name: string;
}

interface AdjustmentFormProps {
  products: Product[];
  warehouses: Warehouse[];
}

const initialState: { success: boolean; message?: string; error?: string } = {
  success: false,
  message: '',
};

// Wrapper for server action to match useFormState signature
async function adjustStockAction(prevState: any, formData: FormData) {
  const productId = formData.get('productId') as string;
  const warehouseId = formData.get('warehouseId') as string;
  const adjustment = Number(formData.get('adjustment'));
  const tagsRaw = formData.get('tags') as string;
  const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];

  if (!productId || !warehouseId || isNaN(adjustment)) {
    return { success: false, error: 'لطفا تمام فیلدها را پر کنید.' };
  }

  const result = await adjustStock(productId, warehouseId, adjustment, undefined, undefined, tags);
  if (result.success) {
    return { success: true, message: result.message || 'Stock adjusted successfully' };
  } else {
    return { success: false, error: result.error || 'Failed to adjust stock' };
  }
}

export function AdjustmentForm({ products, warehouses }: AdjustmentFormProps) {
  const [state, dispatch] = useFormState(adjustStockAction, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>تنظیم موجودی انبار</CardTitle>
      </CardHeader>
      <form action={dispatch}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="productId">محصول</Label>
            <Select name="productId" required>
              <SelectTrigger>
                <SelectValue placeholder="انتخاب محصول" />
              </SelectTrigger>
              <SelectContent>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name} ({product.sku})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="warehouseId">انبار</Label>
            <Select name="warehouseId" required>
              <SelectTrigger>
                <SelectValue placeholder="انتخاب انبار" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="adjustment">مقدار تغییر (مثبت برای افزایش، منفی برای کاهش)</Label>
            <Input 
              id="adjustment" 
              name="adjustment" 
              type="number" 
              placeholder="مثال: 10 یا -5" 
              required 
            />
          </div>

          <TagInput name="tags" label="تگ‌ها (اختیاری)" placeholder="مثلا: ورودی فصلی، اصلاح موجودی..." />

          {state.success && (
            <div className="text-sm p-2 rounded bg-green-100 text-green-700">
              {state.message}
            </div>
          )}
          {state.error && (
            <div className="text-sm p-2 rounded bg-red-100 text-red-700">
              {state.error}
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-end">
          <SubmitButton />
        </CardFooter>
      </form>
    </Card>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'در حال ثبت...' : 'ثبت تغییرات'}
    </Button>
  );
}
