'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { deletePromotion } from '@/actions/promotion';
import { toast } from 'sonner';
import { useState } from 'react';


import { formatJalaliDate } from '@/lib/date-utils';
interface Promotion {
  id: string;
  name: string;
  description?: string;
  type: string;
  discountPercent?: number;
  discountAmount?: number;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  usedCount: number;
  maxUses?: number;
}


interface PromotionListProps {
  promotions: Promotion[];
}

export function PromotionList({ promotions }: PromotionListProps) {
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (!confirm('آیا از حذف این کد تخفیف اطمینان دارید؟')) return;
    
    setIsDeleting(id);
    const result = await deletePromotion(id);
    setIsDeleting(null);

    if (result.success) {
      toast.success(result.message);
    } else {
      toast.error(result.message);
    }
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>کد تخفیف</TableHead>
            <TableHead>نوع</TableHead>
            <TableHead>مقدار</TableHead>
            <TableHead>اعتبار تا</TableHead>
            <TableHead>وضعیت</TableHead>
            <TableHead>استفاده شده</TableHead>
            <TableHead className="text-left">عملیات</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {promotions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                هیچ کد تخفیفی یافت نشد.
              </TableCell>
            </TableRow>
          ) : (
            promotions.map((promo) => (
              <TableRow key={promo.id}>
                <TableCell className="font-mono font-bold">{promo.name}</TableCell>
                <TableCell>
                  {promo.type === 'DISCOUNT' ? 'کد تخفیف' : promo.type === 'GIFT' ? 'هدیه' : 'کد تخفیف'}
                </TableCell>
                <TableCell>
                  {promo.discountPercent 
                    ? `${Number(promo.discountPercent)}%` 
                    : promo.discountAmount 
                      ? `${new Intl.NumberFormat('fa-IR').format(Number(promo.discountAmount))} تومان`
                      : '-'}
                </TableCell>
                <TableCell>
                  {formatJalaliDate(promo.endDate)}
                </TableCell>
                <TableCell>
                  <Badge variant={promo.isActive ? 'default' : 'secondary'}>
                    {promo.isActive ? 'فعال' : 'غیرفعال'}
                  </Badge>
                </TableCell>
                <TableCell>
                  {promo.usedCount} / {promo.maxUses || 'نامحدود'}
                </TableCell>
                <TableCell className="text-left">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => handleDelete(promo.id)}
                    disabled={isDeleting === promo.id}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
