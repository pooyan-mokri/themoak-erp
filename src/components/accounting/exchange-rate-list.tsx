'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { setExchangeRate } from '@/actions/accounting';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Currency } from '@/lib/types';

import { formatJalaliDate } from '@/lib/date-utils';
const initialState = {
  message: '',
  errors: {},
};

export function ExchangeRateManager({ rates }: { rates: any[] }) {
  const [state, dispatch] = useFormState(setExchangeRate, initialState);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>ثبت نرخ ارز جدید</CardTitle>
        </CardHeader>
        <form action={dispatch}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currency">ارز</Label>
              <Select name="currency" required>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب ارز" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={Currency.USD}>دلار ({Currency.USD})</SelectItem>
                  <SelectItem value={Currency.EUR}>یورو ({Currency.EUR})</SelectItem>
                  <SelectItem value={Currency.CNY}>یوآن ({Currency.CNY})</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rateToToman">نرخ تبدیل به تومان</Label>
              <Input id="rateToToman" name="rateToToman" type="number" placeholder="مثال: 60000" required />
            </div>
            {state.message && (
              <div className={`text-sm p-2 rounded ${state.message.includes('موفقیت') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                {state.message}
              </div>
            )}
            <SubmitButton />
          </CardContent>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>آخرین نرخ‌ها</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ارز</TableHead>
                <TableHead>نرخ (تومان)</TableHead>
                <TableHead>تاریخ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map((rate) => (
                <TableRow key={rate.id}>
                  <TableCell className="font-bold">{rate.currency}</TableCell>
                  <TableCell>{Number(rate.rateToToman).toLocaleString()}</TableCell>
                  <TableCell>{formatJalaliDate(rate.date)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'در حال ثبت...' : 'ثبت نرخ'}
    </Button>
  );
}
