'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { transferStock } from '@/actions/inventory';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TagInput } from '@/components/ui/tag-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { useEffect } from 'react';

const initialState = {
  success: false,
  error: undefined as string | undefined,
  message: '',
};

interface TransferFormProps {
  warehouses: { id: string; name: string }[];
  products: { id: string; name: string; sku: string }[];
}

export function TransferForm({ warehouses, products }: TransferFormProps) {
  const transferAction = async (prevState: any, formData: FormData) => {
    const productId = formData.get('productId') as string;
    const fromWarehouseId = formData.get('fromWarehouseId') as string;
    const toWarehouseId = formData.get('toWarehouseId') as string;
    const quantity = Number(formData.get('quantity'));
    const tagsRaw = formData.get('tags') as string;
    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];

    if (!productId || !fromWarehouseId || !toWarehouseId || !quantity) {
      return { success: false, error: 'لطفا تمام فیلدها را پر کنید', message: '' };
    }

    if (fromWarehouseId === toWarehouseId) {
      return { success: false, error: 'انبار مبدا و مقصد نمی‌توانند یکسان باشند', message: '' };
    }

    const result = await transferStock(productId, fromWarehouseId, toWarehouseId, quantity, undefined, undefined, tags);
    return {
        success: result.success,
        message: result.message || '',
        error: result.error
    };
  };

  const [state, dispatch] = useFormState(transferAction, initialState);

  useEffect(() => {
    if (state.success) {
      toast.success(state.message);
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>انتقال موجودی بین انبارها</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={dispatch} className="space-y-4">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fromWarehouseId">انبار مبدا</Label>
              <Select name="fromWarehouseId" required>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب مبدا" />
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
              <Label htmlFor="toWarehouseId">انبار مقصد</Label>
              <Select name="toWarehouseId" required>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب مقصد" />
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
          </div>

          <div className="space-y-2">
            <Label htmlFor="quantity">تعداد</Label>
            <Input
              id="quantity"
              name="quantity"
              type="number"
              min="1"
              placeholder="0"
              required
            />
          </div>

          <TagInput name="tags" label="تگ‌ها (اختیاری)" placeholder="مثلا: انتقال فصلی، اضطراری..." />

          <SubmitButton />
        </form>
      </CardContent>
    </Card>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'در حال انتقال...' : 'انتقال موجودی'}
    </Button>
  );
}
