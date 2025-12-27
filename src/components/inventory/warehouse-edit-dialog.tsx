'use client';

import { useState, useEffect } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { updateWarehouse } from '@/actions/warehouse';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';

interface Warehouse {
  id: string;
  name: string;
  isVirtual: boolean;
}

interface State {
  message: string;
  errors?: {
    name?: string[];
    isVirtual?: string[];
  };
  success?: boolean;
}

const initialState: State = {
  message: '',
  errors: {},
  success: false,
};

export function WarehouseEditDialog({ warehouse }: { warehouse: Warehouse }) {
  const [open, setOpen] = useState(false);
  const updateWarehouseWithId = updateWarehouse.bind(null, warehouse.id);
  const [state, dispatch] = useFormState(updateWarehouseWithId, initialState);

  useEffect(() => {
    if (state.message) {
      if (state.success) {
        toast.success(state.message);
        setOpen(false);
      } else {
        toast.error(state.message);
      }
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ویرایش انبار</DialogTitle>
        </DialogHeader>
        <form action={dispatch} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">نام انبار</Label>
            <Input 
              id="name" 
              name="name" 
              defaultValue={warehouse.name} 
              required 
            />
            {(state.errors as Record<string, string[] | undefined> | undefined)?.name && <p className="text-red-500 text-sm">{(state.errors as Record<string, string[] | undefined> | undefined)?.name}</p>}
          </div>
          <div className="flex items-center space-x-2 space-x-reverse">
            <Switch 
              id="isVirtual" 
              name="isVirtual" 
              defaultChecked={warehouse.isVirtual} 
            />
            <Label htmlFor="isVirtual">انبار مجازی</Label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              انصراف
            </Button>
            <SubmitButton />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'در حال ویرایش...' : 'ویرایش'}
    </Button>
  );
}
