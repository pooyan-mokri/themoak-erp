'use client';

import { unarchiveWarehouse } from '@/actions/warehouse';
import { ArchiveRestore, Eye } from 'lucide-react';
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
import { formatJalaliDate } from '@/lib/date-utils';

interface ArchivedWarehouse {
  id: string;
  name: string;
  isVirtual: boolean;
  archivedAt?: Date | string;
}

interface Props {
  warehouses: ArchivedWarehouse[];
  isAdmin?: boolean;
}

export function WarehouseArchivedList({ warehouses, isAdmin = false }: Props) {
  const handleUnarchive = async (id: string) => {
    if (confirm('این انبار از آرشیو خارج شده و دوباره در فهرست‌ها و انتخاب‌ها نمایش داده می‌شود. ادامه می‌دهید؟')) {
      const result = await unarchiveWarehouse(id);
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    }
  };

  if (warehouses.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center text-muted-foreground">
        هیچ انبار آرشیو شده‌ای وجود ندارد.
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-right">نام انبار</TableHead>
            <TableHead className="text-right">نوع</TableHead>
            <TableHead className="text-right">تاریخ آرشیو</TableHead>
            <TableHead className="text-left">عملیات</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {warehouses.map((warehouse) => (
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
              <TableCell className="text-muted-foreground">
                {warehouse.archivedAt ? formatJalaliDate(warehouse.archivedAt) : '—'}
              </TableCell>
              <TableCell className="text-left">
                <div className="flex justify-end gap-2">
                  <Link href={`/dashboard/inventory/warehouses/${warehouse.id}`}>
                    <Button variant="ghost" size="icon" title="مشاهده انبار و تاریخچه">
                      <Eye className="h-4 w-4" />
                    </Button>
                  </Link>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-green-600 hover:text-green-700 hover:bg-green-50"
                      onClick={() => handleUnarchive(warehouse.id)}
                      title="بازگرداندن از آرشیو"
                    >
                      <ArchiveRestore className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
