'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createProduct, updateProduct } from '@/actions/product';
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
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ProductImageUpload } from './product-image-upload';

const initialState = {
  message: '',
  errors: {},
  success: false,
};

interface ProductFormProps {
  initialData?: any;
  onSuccess?: () => void;
}

export function ProductForm({ initialData, onSuccess }: ProductFormProps) {
  const updateProductWithId = initialData ? updateProduct.bind(null, initialData.id) : undefined;
  const action = initialData ? updateProductWithId : createProduct;
  
  const [productType, setProductType] = useState<string>(
    initialData?.productType || 'SALEABLE'
  );
  const [imageUrl, setImageUrl] = useState<string | undefined>(initialData?.image || undefined);
  
  // @ts-ignore
  const [state, dispatch] = useFormState(action, initialState);

  // Update productType and imageUrl when initialData changes
  useEffect(() => {
    if (initialData?.productType) {
      setProductType(initialData.productType);
    }
    if (initialData?.image !== undefined) {
      setImageUrl(initialData.image || undefined);
    }
  }, [initialData]);

  useEffect(() => {
    if (state.message && state.success) {
      toast.success(state.message);
      if (onSuccess) onSuccess();
    } else if (state.message && !state.success) {
      toast.error(state.message);
    }
  }, [state, onSuccess]);

  return (
    <Card className={initialData ? 'border-0 shadow-none' : ''}>
      {!initialData && (
        <CardHeader>
          <CardTitle>تعریف کالای جدید</CardTitle>
        </CardHeader>
      )}
      <form action={dispatch}>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">نام کالا *</Label>
              <Input 
                id="name" 
                name="name" 
                placeholder="مثال: عینک آفتابی مدل X" 
                required 
                defaultValue={initialData?.name}
              />
              {(state.errors as Record<string, string[] | undefined> | undefined)?.name && <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.name}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="sku">کد کالا (SKU) *</Label>
              <Input 
                id="sku" 
                name="sku" 
                placeholder="SUN-001" 
                required 
                defaultValue={initialData?.sku}
              />
              {(state.errors as Record<string, string[] | undefined> | undefined)?.sku && <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.sku}</p>}
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="productType">نوع کالا *</Label>
              <Select
                name="productType"
                value={productType}
                onValueChange={setProductType}
              >
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب نوع کالا" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SALEABLE">محصول فروختنی</SelectItem>
                  <SelectItem value="FIXED_ASSET">دارایی ثابت</SelectItem>
                  <SelectItem value="CONSUMABLE">کالای مصرفی</SelectItem>
                  <SelectItem value="OTHER">سایر</SelectItem>
                </SelectContent>
              </Select>
              <input type="hidden" name="productType" value={productType} />
              {(state.errors as Record<string, string[] | undefined> | undefined)?.productType && <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.productType}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="costPrice">قیمت خرید (تومان)</Label>
              <Input 
                id="costPrice" 
                name="costPrice" 
                type="number" 
                min="0" 
                required 
                defaultValue={initialData ? Number(initialData.costPrice) : undefined}
              />
              {(state.errors as Record<string, string[] | undefined> | undefined)?.costPrice && <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.costPrice}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="sellPrice">
                قیمت فروش (تومان)
                {productType === 'SALEABLE' && ' *'}
              </Label>
              <Input 
                id="sellPrice" 
                name="sellPrice" 
                type="number" 
                min="0" 
                required={productType === 'SALEABLE'}
                defaultValue={initialData ? Number(initialData.sellPrice) : undefined}
              />
              {(state.errors as Record<string, string[] | undefined> | undefined)?.sellPrice && <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.sellPrice}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="wooId">شناسه ووکامرس (اختیاری)</Label>
              <Input 
                id="wooId" 
                name="wooId" 
                type="number" 
                placeholder="12345" 
                defaultValue={initialData?.wooId || undefined}
              />
            </div>
          </div>
          <div className="md:col-span-2">
            <input type="hidden" name="image" value={imageUrl || ''} />
            <ProductImageUpload
              onUploadComplete={(url) => setImageUrl(url)}
              onRemove={() => setImageUrl(undefined)}
              currentUrl={imageUrl}
            />
          </div>
          {state.message && !state.success && (
            <div className="text-sm p-2 rounded bg-red-100 text-red-700">
              {state.message}
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-end">
          <SubmitButton isEdit={!!initialData} />
        </CardFooter>
      </form>
    </Card>
  );
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'در حال پردازش...' : (isEdit ? 'ویرایش کالا' : 'ثبت کالا')}
    </Button>
  );
}
