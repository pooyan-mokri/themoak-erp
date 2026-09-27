'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteShareholder } from '@/actions/shareholder';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Trash2, Edit, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ShareholderForm } from './shareholder-form';
import { fa } from './finance-bits';

interface Shareholder {
  id: string;
  name: string;
  percentage: number;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  _count: {
    transactions: number;
  };
}

interface ShareholderListProps {
  shareholders: Shareholder[];
  /** Capital balance per shareholder id: positive, the company owes them; negative, they owe the company. */
  balances?: Record<string, number>;
  /** May add, edit and remove shareholders (finance.manage). */
  canManage?: boolean;
}

const pct = (n: number) => `${fa(n, 2)}٪`;

/** The header button that opens the new-shareholder form. */
export function NewShareholderButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        سهامدار جدید
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>سهامدار جدید</DialogTitle>
          </DialogHeader>
          {open && (
            <ShareholderForm
              bare
              onSuccess={() => {
                setOpen(false);
                router.refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ShareholderList({ shareholders: initialShareholders, balances = {}, canManage = false }: ShareholderListProps) {
  const [shareholders, setShareholders] = useState(initialShareholders);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [shareholderToDelete, setShareholderToDelete] = useState<Shareholder | undefined>(undefined);
  const [editShareholder, setEditShareholder] = useState<Shareholder | undefined>(undefined);

  // A shareholder added from the header arrives as new props.
  useEffect(() => {
    setShareholders(initialShareholders);
  }, [initialShareholders]);

  const handleDelete = async (shareholder: Shareholder) => {
    setShareholderToDelete(shareholder);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!shareholderToDelete) return;

    const result = await deleteShareholder(shareholderToDelete.id);
    if (result.success) {
      toast.success(result.message);
      setShareholders(shareholders.filter((s) => s.id !== shareholderToDelete.id));
    } else {
      toast.error(result.message);
    }
    setDeleteDialogOpen(false);
    setShareholderToDelete(undefined);
  };

  const handleEdit = (shareholder: Shareholder) => {
    setEditShareholder(shareholder);
  };

  const handleEditSuccess = () => {
    setEditShareholder(undefined);
    window.location.reload();
  };

  const totalPercentage = shareholders.reduce((sum, s) => sum + s.percentage, 0);

  return (
    <>
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-3">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            سهامداران
            <span className="rounded bg-secondary px-1.5 font-mono text-[11px] font-normal text-muted-foreground">{fa(shareholders.length)}</span>
          </h3>
          <span className="text-[12.5px] text-muted-foreground">
            مجموع سهم‌ها {pct(totalPercentage)}
            {totalPercentage < 100 && ` · ${pct(100 - totalPercentage)} باقیمانده`}
            {totalPercentage > 100 && (
              <span className="ms-2 rounded-full bg-danger-soft px-2 py-0.5 text-[11.5px] text-danger">بیش از ۱۰۰٪</span>
            )}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-y">
                <th className="h-9 bg-secondary px-4 text-start text-xs font-normal text-muted-foreground">سهامدار</th>
                <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">سهم</th>
                <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">تماس</th>
                <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">مانده سرمایه (تومان)</th>
                <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">تراکنش‌ها</th>
                {canManage && <th className="h-9 w-[88px] bg-secondary px-3" />}
              </tr>
            </thead>
            <tbody>
              {shareholders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="h-24 px-4 text-center text-[13px] text-muted-foreground">
                    هنوز سهامداری تعریف نشده است.{canManage && ' با «سهامدار جدید» نام و درصد سهم را ثبت کنید.'}
                  </td>
                </tr>
              ) : (
                shareholders.map((shareholder) => {
                  const balance = balances[shareholder.id] ?? 0;
                  return (
                    <tr key={shareholder.id} className="h-11 border-b transition-colors duration-150 last:border-0 hover:bg-brand/[.04]">
                      <td className="px-4 font-medium">{shareholder.name}</td>
                      <td className="px-3 text-end tabular-nums">{pct(shareholder.percentage)}</td>
                      <td className="px-3 text-[12.5px] text-muted-foreground">
                        {[shareholder.phone, shareholder.email].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-3 text-end tabular-nums">
                        {balance === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            {fa(Math.abs(balance))}{' '}
                            <span className="text-[12px] text-muted-foreground">{balance > 0 ? 'طلبکار' : 'بدهکار'}</span>
                          </>
                        )}
                      </td>
                      <td className="px-3 text-end tabular-nums text-muted-foreground">{fa(shareholder._count.transactions)}</td>
                      {canManage && (
                        <td className="px-3">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => handleEdit(shareholder)} title={`ویرایش ${shareholder.name}`}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-danger hover:bg-danger-soft"
                              onClick={() => handleDelete(shareholder)}
                              title={`حذف ${shareholder.name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>حذف سهامدار</DialogTitle>
            <DialogDescription>
              «{shareholderToDelete?.name}» با {pct(shareholderToDelete?.percentage ?? 0)} سهم حذف شود؟ سهامداری که تراکنش دارد حذف نمی‌شود. این
              عمل قابل بازگشت نیست.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              انصراف
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editShareholder && (
        <Dialog open={!!editShareholder} onOpenChange={() => setEditShareholder(undefined)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>ویرایش سهامدار</DialogTitle>
            </DialogHeader>
            <ShareholderForm
              initialData={editShareholder}
              onSuccess={handleEditSuccess}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
