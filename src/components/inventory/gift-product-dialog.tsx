'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
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
import { Textarea } from '@/components/ui/textarea';
import { Gift } from 'lucide-react';
import { giftProduct } from '@/actions/product';

interface GiftProductDialogProps {
  productId: string;
  productName: string;
}

export function GiftProductDialog({ productId, productName }: GiftProductDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [quantity, setQuantity] = useState(1);
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');

  const handleGift = () => {
    if (!recipient) {
      toast.error('لطفا نام گیرنده را وارد کنید.');
      return;
    }

    startTransition(async () => {
      const result = await giftProduct(productId, quantity, recipient, note);
      if (result.success) {
        toast.success('هدیه با موفقیت ثبت شد.');
        setOpen(false);
        setQuantity(1);
        setRecipient('');
        setNote('');
        // The gift took stock: show the new quantities.
        router.refresh();
      } else {
        toast.error('error' in result ? result.error : result.message);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" title="هدیه دادن">
          <Gift className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>هدیه دادن محصول</DialogTitle>
          <DialogDescription>
            ثبت {productName} به عنوان هدیه. این کار موجودی را کاهش داده و هزینه ثبت می‌کند.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="quantity" className="text-start">
              تعداد
            </Label>
            <Input
              id="quantity"
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value))}
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="recipient" className="text-start">
              گیرنده
            </Label>
            <Input
              id="recipient"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="col-span-3"
              placeholder="نام شخص یا شرکت"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="note" className="text-start">
              یادداشت
            </Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="col-span-3"
              placeholder="توضیحات اختیاری"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="submit" onClick={handleGift} disabled={isPending}>
            {isPending ? 'در حال ثبت...' : 'ثبت هدیه'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
