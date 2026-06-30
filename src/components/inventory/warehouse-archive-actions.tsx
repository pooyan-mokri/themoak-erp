'use client';

import { archiveWarehouse, unarchiveWarehouse } from '@/actions/warehouse';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Archive, ArchiveRestore } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  warehouseId: string;
  isArchived: boolean;
  totalStock: number;
  isAdmin: boolean;
}

export function WarehouseArchiveActions({ warehouseId, isArchived, totalStock, isAdmin }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const run = async (fn: () => Promise<{ success: boolean; message: string }>) => {
    setLoading(true);
    const result = await fn();
    setLoading(false);
    if (result.success) {
      toast.success(result.message);
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  if (isArchived) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-100">
          <Archive className="h-3 w-3 ml-1" />
          آرشیو شده
        </Badge>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            className="text-green-700 border-green-300 hover:bg-green-50"
            disabled={loading}
            onClick={() => run(() => unarchiveWarehouse(warehouseId))}
          >
            <ArchiveRestore className="h-4 w-4 ml-2" />
            بازگرداندن از آرشیو
          </Button>
        )}
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      className="text-amber-700 border-amber-300 hover:bg-amber-50 disabled:opacity-40"
      disabled={loading || totalStock !== 0}
      title={totalStock === 0 ? 'آرشیو انبار' : 'فقط انبارهای با موجودی صفر قابل آرشیو هستند'}
      onClick={() => {
        if (confirm('این انبار آرشیو می‌شود و از فهرست‌ها و انتخاب‌ها پنهان می‌شود. می‌توانید بعداً آن را بازگردانید. ادامه می‌دهید؟')) {
          run(() => archiveWarehouse(warehouseId));
        }
      }}
    >
      <Archive className="h-4 w-4 ml-2" />
      آرشیو انبار
    </Button>
  );
}
