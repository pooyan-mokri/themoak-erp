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
import { ChannelRow, ChannelsEditor, channelRowsError, channelRowsOf } from './partner-form';

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
      channels?: {
        id: string;
        name: string;
        commissionRate: number;
        isDefault: boolean;
        isActive: boolean;
      }[];
    };
  };
}

const initialState = {
  message: '',
  errors: {} as Record<string, string[]>,
};

export function PartnerEditForm({ partner }: PartnerEditFormProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ChannelRow[]>(() => channelRowsOf(partner.customer?.channels));
  const [channelError, setChannelError] = useState<string | null>(null);
  const [state, dispatch] = useFormState(
    updateConsignmentPartner.bind(null, partner.id),
    initialState
  );

  if (state.success && open) {
    toast.success(state.message);
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Reopening starts from the partner's saved channels again, like the other fields.
        if (next) {
          setRows(channelRowsOf(partner.customer?.channels));
          setChannelError(null);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="h-4 w-4 ml-2" />
          ویرایش
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ویرایش همکار امانی</DialogTitle>
          <DialogDescription>
            اطلاعات همکار امانی را ویرایش کنید.
          </DialogDescription>
        </DialogHeader>
        <form
          action={dispatch}
          onSubmit={(event) => {
            const problem = channelRowsError(rows);
            setChannelError(problem);
            if (problem) event.preventDefault();
          }}
        >
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
              {(state.errors as Record<string, string[] | undefined> | undefined)?.name?.[0] && (
                <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.name?.[0]}</p>
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
            <ChannelsEditor
              rows={rows}
              setRows={setRows}
              idPrefix={`partner-${partner.id}`}
              error={channelError}
            />
            {state.message && !state.success && (
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
