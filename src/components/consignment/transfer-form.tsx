'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { transferStock } from '@/actions/consignment';
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

interface TransferFormProps {
  warehouses: Warehouse[];
  products: Product[];
}

export function TransferForm({ warehouses, products }: TransferFormProps) {
  const [state, dispatch] = useFormState(transferStock, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>انتقال موجودی به همکار</CardTitle>
      </CardHeader>
      <form action={dispatch}>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="sourceWarehouseId">انبار مبدا</Label>
              <Select name="sourceWarehouseId" required>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب انبار مبدا" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="targetWarehouseId">انبار مقصد (همکار)</Label>
              <Select name="targetWarehouseId" required>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب انبار مقصد" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="productId">محصول</Label>
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
              <Label htmlFor="quantity">تعداد</Label>
              <Input id="quantity" name="quantity" type="number" min="1" required />
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
      {pending ? 'در حال انتقال...' : 'انتقال موجودی'}
    </Button>
  );
}
