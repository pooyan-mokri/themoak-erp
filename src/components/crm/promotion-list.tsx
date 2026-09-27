'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Trash2 } from 'lucide-react';
import { deletePromotion } from '@/actions/promotion';
import { toast } from 'sonner';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { formatJalaliDate } from '@/lib/date-utils';
import { PILL, fa } from './crm-labels';

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
  /** May delete a code (sales.manage); the server checks it again. */
  canManage?: boolean;
}

export function PromotionList({ promotions, canManage = true }: PromotionListProps) {
  const [isDeleting, setIsDeleting] = useState<string | undefined>(undefined);

  const handleDelete = async (id: string) => {
    setIsDeleting(id);
    const result = await deletePromotion(id);
    setIsDeleting(undefined);

    if (result.success) {
      toast.success(result.message);
    } else {
      toast.error(result.message);
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>کد تخفیف</TableHead>
            <TableHead>نوع</TableHead>
            <TableHead className="text-end">مقدار</TableHead>
            <TableHead>اعتبار تا</TableHead>
            <TableHead>وضعیت</TableHead>
            <TableHead className="text-end">استفاده شده</TableHead>
            {canManage && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {promotions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                هیچ کد تخفیفی ثبت نشده است. با «کد تخفیف جدید» یک کد با درصد یا مبلغ و تاریخ اعتبار بسازید.
              </TableCell>
            </TableRow>
          ) : (
            promotions.map((promo) => (
              <TableRow key={promo.id}>
                <TableCell className="font-mono font-bold">{promo.name}</TableCell>
                <TableCell>
                  {promo.type === 'DISCOUNT' ? 'کد تخفیف' : promo.type === 'GIFT' ? 'هدیه' : 'کد تخفیف'}
                </TableCell>
                <TableCell className="text-end">
                  {promo.discountPercent
                    ? `${fa(Number(promo.discountPercent))}٪`
                    : promo.discountAmount
                      ? `${fa(Number(promo.discountAmount))} تومان`
                      : '—'}
                </TableCell>
                <TableCell className="font-mono text-[12px] text-muted-foreground">{formatJalaliDate(promo.endDate)}</TableCell>
                <TableCell>
                  <span className={cn(PILL, promo.isActive ? 'bg-success-soft text-success' : 'bg-secondary text-muted-foreground')}>
                    {promo.isActive ? 'فعال' : 'غیرفعال'}
                  </span>
                </TableCell>
                <TableCell className="text-end">
                  {fa(promo.usedCount)} / {promo.maxUses ? fa(promo.maxUses) : 'نامحدود'}
                </TableCell>
                {canManage && (
                  <TableCell className="text-end">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-danger"
                          disabled={isDeleting === promo.id}
                          title="حذف"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>حذف کد تخفیف «{promo.name}»</AlertDialogTitle>
                          <AlertDialogDescription>آیا از حذف این کد تخفیف اطمینان دارید؟ این عمل قابل بازگشت نیست.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>انصراف</AlertDialogCancel>
                          <AlertDialogAction className={buttonVariants({ variant: 'destructive' })} onClick={() => handleDelete(promo.id)}>
                            حذف {promo.name}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
