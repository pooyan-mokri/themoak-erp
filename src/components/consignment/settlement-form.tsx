'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { settleSales } from '@/actions/consignment';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

const initialState = {
  message: '',
  errors: {},
};

interface Warehouse {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
}

interface SettlementFormProps {
  partners: Warehouse[]; // Virtual warehouses
  products: Product[];
}

export function SettlementForm({ partners, products }: SettlementFormProps) {
  const [state, dispatch] = useFormState(settleSales, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>ثبت فروش امانی (تسویه)</CardTitle>
      </CardHeader>
      <form action={dispatch}>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="partnerWarehouseId">همکار (انبار مجازی)</Label>
              <Select name="partnerWarehouseId" required>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب همکار" />
                </SelectTrigger>
                <SelectContent>
                  {partners.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="productId">محصول فروخته شده</Label>
              <Select name="productId" required>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب محصول" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quantity">تعداد فروش</Label>
              <Input id="quantity" name="quantity" type="number" min="1" required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="unitPrice">قیمت توافقی (واحد)</Label>
              <Input id="unitPrice" name="unitPrice" type="number" min="0" required />
            </div>
          </div>

          {state.message && (
            <div className={`text-sm p-2 rounded ${state.message.includes('موفقیت') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {state.message}
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
      {pending ? 'در حال ثبت...' : 'ثبت فروش'}
    </Button>
  );
}
