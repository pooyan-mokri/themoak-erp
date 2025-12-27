'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { updateConsignmentPartner } from '@/actions/consignment';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

interface PartnerEditFormProps {
  partner: {
    id: string;
    name: string;
    customer?: {
      id: string;
      name: string;
      phone?: string;
      address?: string;
      commissionRate?: number;
    };
  };
}

const initialState = {
  message: '',
  errors: {} as Record<string, string[]>,
};

export function PartnerEditForm({ partner }: PartnerEditFormProps) {
  const [open, setOpen] = useState(false);
  const [state, dispatch] = useFormState(
    updateConsignmentPartner.bind(null, partner.id),
    initialState
  );

  if (state.message && Object.keys(state.errors || {}).length === 0 && open) {
    toast.success(state.message);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="h-4 w-4 ml-2" />
          ویرایش
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>ویرایش همکار امانی</DialogTitle>
          <DialogDescription>
            اطلاعات همکار امانی را ویرایش کنید.
          </DialogDescription>
        </DialogHeader>
        <form action={dispatch}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">نام همکار / فروشگاه</Label>
              <Input
                id="edit-name"
                name="name"
                defaultValue={partner.customer?.name || partner.name.replace('انبار امانی - ', '')}
                placeholder="مثال: گالری نور"
                required
              />
              {state.errors?.name?.[0] && (
                <p className="text-red-500 text-sm">{state.errors.name?.[0]}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-phone">شماره تماس</Label>
              <Input
                id="edit-phone"
                name="phone"
                defaultValue={partner.customer?.phone || ''}
                placeholder="0912..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-address">آدرس</Label>
              <Textarea
                id="edit-address"
                name="address"
                defaultValue={partner.customer?.address || ''}
                placeholder="آدرس کامل..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-commissionRate">
                درصد کمیسیون (۰ تا ۱۰۰)
              </Label>
              <Input
                id="edit-commissionRate"
                name="commissionRate"
                type="number"
                min="0"
                max="100"
                step="0.1"
                defaultValue={partner.customer?.commissionRate || ''}
                placeholder="مثال: 15"
              />
              <p className="text-xs text-muted-foreground">
                درصد کمیسیون که به ازای هر فروش به این همکار پرداخت می‌شود
              </p>
              {state.errors?.commissionRate?.[0] && (
                <p className="text-red-500 text-sm">{state.errors.commissionRate?.[0]}</p>
              )}
            </div>
            {state.message && Object.keys(state.errors || {}).length > 0 && (
              <div className="text-sm p-2 rounded bg-red-100 text-red-700">
                {state.message}
              </div>
            )}
          </div>
          <DialogFooter>
            <SubmitButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
    </Button>
  );
}

