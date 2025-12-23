'use client';

import { useState } from 'react';
import { deleteShareholder } from '@/actions/shareholder';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Trash2, Edit } from 'lucide-react';
import { toast } from 'sonner';
import { ShareholderForm } from './shareholder-form';

interface Shareholder {
  id: string;
  name: string;
  percentage: number;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  _count: {
    transactions: number;
  };
}

interface ShareholderListProps {
  shareholders: Shareholder[];
}

export function ShareholderList({ shareholders: initialShareholders }: ShareholderListProps) {
  const [shareholders, setShareholders] = useState(initialShareholders);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [shareholderToDelete, setShareholderToDelete] = useState<string | null>(null);
  const [editShareholder, setEditShareholder] = useState<Shareholder | null>(null);

  const handleDelete = async (id: string) => {
    setShareholderToDelete(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!shareholderToDelete) return;

    const result = await deleteShareholder(shareholderToDelete);
    if (result.success) {
      toast.success(result.message);
      setShareholders(shareholders.filter((s) => s.id !== shareholderToDelete));
    } else {
      toast.error(result.message);
    }
    setDeleteDialogOpen(false);
    setShareholderToDelete(null);
  };

  const handleEdit = (shareholder: Shareholder) => {
    setEditShareholder(shareholder);
  };

  const handleEditSuccess = () => {
    setEditShareholder(null);
    window.location.reload();
  };

  const totalPercentage = shareholders.reduce((sum, s) => sum + s.percentage, 0);

  return (
    <>
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="p-6">
          <h2 className="text-2xl font-semibold mb-4">لیست صاحبان سهام</h2>
          <div className="mb-4 p-3 bg-muted rounded-md">
            <div className="flex justify-between items-center">
              <span className="font-medium">درصد کل سهام:</span>
              <span className={`font-bold ${totalPercentage > 100 ? 'text-red-500' : totalPercentage === 100 ? 'text-green-500' : 'text-orange-500'}`}>
                {totalPercentage.toFixed(2)}%
              </span>
            </div>
            {totalPercentage !== 100 && (
              <p className="text-sm text-muted-foreground mt-1">
                {totalPercentage < 100
                  ? `${(100 - totalPercentage).toFixed(2)}% باقیمانده است`
                  : 'هشدار: مجموع درصدها بیشتر از 100 است!'}
              </p>
            )}
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>نام</TableHead>
                  <TableHead>درصد سهام</TableHead>
                  <TableHead>تلفن</TableHead>
                  <TableHead>ایمیل</TableHead>
                  <TableHead>تعداد واریزها</TableHead>
                  <TableHead className="text-left">عملیات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shareholders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      هیچ صاحب سهامی ثبت نشده است
                    </TableCell>
                  </TableRow>
                ) : (
                  shareholders.map((shareholder) => (
                    <TableRow key={shareholder.id}>
                      <TableCell className="font-medium">{shareholder.name}</TableCell>
                      <TableCell>{shareholder.percentage.toFixed(2)}%</TableCell>
                      <TableCell>{shareholder.phone || '-'}</TableCell>
                      <TableCell>{shareholder.email || '-'}</TableCell>
                      <TableCell>{shareholder._count.transactions}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(shareholder)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(shareholder.id)}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>حذف صاحب سهام</DialogTitle>
            <DialogDescription>
              آیا از حذف این صاحب سهام مطمئن هستید؟ این عمل قابل بازگشت نیست.
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
        <Dialog open={!!editShareholder} onOpenChange={() => setEditShareholder(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>ویرایش صاحب سهام</DialogTitle>
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

