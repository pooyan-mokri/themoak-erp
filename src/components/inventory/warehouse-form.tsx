'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createWarehouse } from '@/actions/warehouse';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

const initialState = {
  message: '',
  errors: {},
};

export function WarehouseForm() {
  const [state, dispatch] = useFormState(createWarehouse, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>افزودن انبار جدید</CardTitle>
      </CardHeader>
      <form action={dispatch}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">نام انبار</Label>
            <Input id="name" name="name" placeholder="مثال: انبار مرکزی" required />
            {state.errors?.name && <p className="text-red-500 text-sm">{state.errors.name}</p>}
          </div>
          <div className="flex items-center space-x-2 space-x-reverse">
            <Switch id="isVirtual" name="isVirtual" />
            <Label htmlFor="isVirtual">انبار مجازی (برای فروشندگان امانی)</Label>
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
      {pending ? 'در حال ثبت...' : 'ثبت انبار'}
    </Button>
  );
}
