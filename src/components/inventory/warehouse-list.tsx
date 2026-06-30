'use client';

import { deleteWarehouse, archiveWarehouse } from '@/actions/warehouse';
import { WarehouseEditDialog } from './warehouse-edit-dialog';
import { Trash2, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

interface Warehouse {
  id: string;
  name: string;
  isVirtual: boolean;
}

interface WarehouseListProps {
  warehouses: Warehouse[];
  isAdmin?: boolean;
  stockByWarehouse?: Record<string, number>;
}

export function WarehouseList({ warehouses, isAdmin = false, stockByWarehouse = {} }: WarehouseListProps) {
  const handleDelete = async (id: string) => {
    if (confirm('آیا از حذف این انبار اطمینان دارید؟')) {
      const result = await deleteWarehouse(id);
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    }
  };

  const handleArchive = async (id: string) => {
    if (confirm('این انبار آرشیو می‌شود و از فهرست‌ها و انتخاب‌ها پنهان می‌شود. می‌توانید بعداً آن را بازگردانید. ادامه می‌دهید؟')) {
      const result = await archiveWarehouse(id);
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    }
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-right">نام انبار</TableHead>
            <TableHead className="text-right">نوع</TableHead>
            <TableHead className="text-right">موجودی</TableHead>
            <TableHead className="text-left">عملیات</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {warehouses.map((warehouse) => {
            const stock = stockByWarehouse[warehouse.id] ?? 0;
            const canDelete = isAdmin && stock === 0;
            return (
            <TableRow key={warehouse.id}>
              <TableCell className="font-medium">
                <Link
                  href={`/dashboard/inventory/warehouses/${warehouse.id}`}
                  className="hover:underline text-primary"
                >
                  {warehouse.name}
                </Link>
              </TableCell>
              <TableCell>
                {warehouse.isVirtual ? (
                  <Badge variant="secondary">مجازی</Badge>
                ) : (
                  <Badge variant="outline">فیزیکی</Badge>
                )}
              </TableCell>
              <TableCell>
                {stock === 0 ? (
                  <span className="text-muted-foreground">۰</span>
                ) : (
                  <span className="font-medium">{stock.toLocaleString('fa-IR')}</span>
                )}
              </TableCell>
              <TableCell className="text-left">
                <div className="flex justify-end gap-2">
                  <WarehouseEditDialog warehouse={warehouse} />
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 disabled:opacity-30"
                      onClick={() => handleArchive(warehouse.id)}
                      disabled={stock !== 0}
                      title={stock === 0 ? 'آرشیو انبار' : 'فقط انبارهای با موجودی صفر قابل آرشیو هستند'}
                    >
                      <Archive className="h-4 w-4" />
                    </Button>
                  )}
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-red-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-30"
                      onClick={() => handleDelete(warehouse.id)}
                      disabled={!canDelete}
                      title={canDelete ? 'حذف انبار' : 'فقط انبارهای با موجودی صفر قابل حذف هستند'}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
