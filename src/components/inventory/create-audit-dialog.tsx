'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { createInventoryAudit } from '@/actions/inventory-audit';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

interface CreateAuditDialogProps {
  warehouses: Array<{ id: string; name: string }>;
}

export function CreateAuditDialog({ warehouses }: CreateAuditDialogProps) {
  const [open, setOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    if (!warehouseId) {
      toast.error('لطفاً انبار را انتخاب کنید.');
      return;
    }

    const formData = new FormData();
    formData.append('warehouseId', warehouseId);
    const description = (e.currentTarget.elements.namedItem('description') as HTMLTextAreaElement)?.value;
    if (description) {
      formData.append('description', description);
    }

    console.log('Submitting audit form:', { warehouseId, description });

    try {
      const result = await createInventoryAudit(undefined, formData);
      console.log('Audit creation result:', result);
      
      if (result?.success) {
        toast.success(result.message);
        setOpen(false);
        setWarehouseId('');
        if (result.data?.auditId) {
          router.push(`/dashboard/inventory/audits/${result.data.auditId}`);
        } else {
          router.push('/dashboard/inventory/audits');
        }
        router.refresh();
      } else if (result?.message) {
        toast.error(result.message);
      } else {
        toast.error('خطا در ایجاد انبارگردانی. لطفاً دوباره تلاش کنید.');
      }
    } catch (error) {
      console.error('Error creating audit:', error);
      toast.error('خطا در ایجاد انبارگردانی. لطفاً دوباره تلاش کنید.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          ایجاد انبارگردانی جدید
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>ایجاد انبارگردانی جدید</DialogTitle>
            <DialogDescription>
              یک انبارگردانی جدید برای شمارش موجودی ایجاد کنید.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="warehouseId">انبار *</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId} required>
                <SelectTrigger id="warehouseId">
                  <SelectValue placeholder="انتخاب انبار" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input type="hidden" name="warehouseId" value={warehouseId} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">توضیحات</Label>
              <Textarea
                id="description"
                name="description"
                placeholder="توضیحات اختیاری..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              انصراف
            </Button>
            <Button type="submit">ایجاد</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

