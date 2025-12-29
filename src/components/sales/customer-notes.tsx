'use client';

import { useState, useTransition } from 'react';
import { updateCustomerNotes } from '@/actions/customer';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function CustomerNotes({ customerId, initialNotes }: { customerId: string, initialNotes?: string }) {
  const [notes, setNotes] = useState(initialNotes || '');
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    startTransition(async () => {
      const result = await updateCustomerNotes(customerId, notes);
      if (result.success) {
        // Optional: show success toast
      } else {
        alert(result.message);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>یادداشت‌ها</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="یادداشت‌های مربوط به مشتری..."
          rows={5}
        />
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? 'در حال ذخیره...' : 'ذخیره یادداشت'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
