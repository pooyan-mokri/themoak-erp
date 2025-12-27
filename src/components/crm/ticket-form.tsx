'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createTicket } from '@/actions/crm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const initialState = {
  message: '',
  errors: {},
};

const priorities = [
  { value: 'LOW', label: 'پایین' },
  { value: 'MEDIUM', label: 'متوسط' },
  { value: 'HIGH', label: 'بالا' },
  { value: 'URGENT', label: 'فوری' },
];

interface TicketFormProps {
  customers: { id: string; name: string }[];
}

export function TicketForm({ customers }: TicketFormProps) {
  const [state, dispatch] = useFormState(createTicket, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>ایجاد تیکت پشتیبانی</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={dispatch} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="customerId">مشتری *</Label>
            <Select name="customerId" required>
              <SelectTrigger>
                <SelectValue placeholder="انتخاب مشتری" />
              </SelectTrigger>
              <SelectContent>
                {customers.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(state.errors as Record<string, string[] | undefined> | undefined)?.customerId && (
              <p className="text-sm text-red-500">{(state.errors as Record<string, string[] | undefined> | undefined)?.customerId}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="subject">موضوع *</Label>
            <Input
              id="subject"
              name="subject"
              placeholder="موضوع تیکت"
              required
            />
            {(state.errors as Record<string, string[] | undefined> | undefined)?.subject && (
              <p className="text-sm text-red-500">{(state.errors as Record<string, string[] | undefined> | undefined)?.subject}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">شرح مشکل *</Label>
            <Textarea
              id="description"
              name="description"
              placeholder="لطفا مشکل را به طور کامل شرح دهید..."
              rows={5}
              required
            />
            {(state.errors as Record<string, string[] | undefined> | undefined)?.description && (
              <p className="text-sm text-red-500">{(state.errors as Record<string, string[] | undefined> | undefined)?.description}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="priority">اولویت</Label>
            <Select name="priority" defaultValue="MEDIUM">
              <SelectTrigger>
                <SelectValue placeholder="انتخاب اولویت" />
              </SelectTrigger>
              <SelectContent>
                {priorities.map((priority) => (
                  <SelectItem key={priority.value} value={priority.value}>
                    {priority.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {state.message && !state.success && (
            <p className="text-sm text-red-500">{state.message}</p>
          )}

          {state.message && state.success && (
            <p className="text-sm text-green-600">{state.message}</p>
          )}

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
      {pending ? 'در حال ثبت...' : 'ایجاد تیکت'}
    </Button>
  );
}
