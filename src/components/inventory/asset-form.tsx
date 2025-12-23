'use client';

import { useState } from 'react';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createAsset } from '@/actions/fixed-assets';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { AssetType } from '@prisma/client';

export function AssetForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [assetType, setAssetType] = useState<AssetType>(AssetType.FIXED);

  const handleSubmit = async (formData: FormData) => {
    setLoading(true);
    try {
      const result = await createAsset(null, formData);
      if (result.message) {
        if (result.errors) {
          Object.values(result.errors).forEach((error: any) => {
            if (Array.isArray(error)) {
              error.forEach((msg) => toast.error(msg));
            } else {
              toast.error(error);
            }
          });
        } else {
          toast.success(result.message);
          // Reset form
          const form = document.getElementById('asset-form') as HTMLFormElement;
          form?.reset();
          router.refresh();
        }
      }
    } catch (error) {
      toast.error('خطا در ثبت دارایی');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>افزودن دارایی جدید</CardTitle>
        <CardDescription>
          ثبت دارایی ثابت یا کالای مصرفی
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id="asset-form" action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">نام دارایی *</Label>
            <Input
              id="name"
              name="name"
              placeholder="مثال: کامپیوتر، میز، صندلی..."
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="assetType">نوع دارایی *</Label>
            <Select
              name="assetType"
              value={assetType}
              onValueChange={(value) => setAssetType(value as AssetType)}
            >
              <SelectTrigger>
                <SelectValue placeholder="انتخاب نوع دارایی" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AssetType.FIXED}>دارایی ثابت</SelectItem>
                <SelectItem value={AssetType.CONSUMABLE}>کالای مصرفی</SelectItem>
              </SelectContent>
            </Select>
            <input type="hidden" name="assetType" value={assetType} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="purchaseDate">تاریخ خرید *</Label>
            <Input
              id="purchaseDate"
              name="purchaseDate"
              type="date"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="purchasePrice">قیمت خرید (تومان) *</Label>
            <Input
              id="purchasePrice"
              name="purchasePrice"
              type="number"
              min="0"
              step="1000"
              placeholder="0"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="salvageValue">ارزش اسقاط (تومان)</Label>
            <Input
              id="salvageValue"
              name="salvageValue"
              type="number"
              min="0"
              step="1000"
              placeholder="0"
              defaultValue="0"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="usefulLife">عمر مفید (سال) *</Label>
            <Input
              id="usefulLife"
              name="usefulLife"
              type="number"
              min="1"
              placeholder="5"
              required
            />
          </div>

          {assetType === AssetType.CONSUMABLE && (
            <div className="space-y-2">
              <Label htmlFor="quantity">تعداد *</Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                min="1"
                placeholder="0"
                required
              />
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'در حال ثبت...' : 'ثبت دارایی'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

