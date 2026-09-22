'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, FileX, Image as ImageIcon, Loader2, Paperclip, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { attachReceipt } from '@/actions/receipts';
import { deleteReceipt } from '@/actions/upload';
import { isPdfReceipt, receiptViewUrl } from '@/lib/receipt-ref';
import { uploadReceiptFile } from '@/components/accounting/upload-receipt-file';

interface TransactionReceiptProps {
  transactionId: string;
  receiptUrl?: string | null;
  /** May attach a receipt to this row (src/lib/receipt-ref.ts mayAttachReceipt). */
  canAttach: boolean;
  /** May replace the receipt it has: admins only. */
  canReplace: boolean;
}

/** A recorded money row's receipt: open it, or attach one afterwards. */
export function TransactionReceipt({ transactionId, receiptUrl, canAttach, canReplace }: TransactionReceiptProps) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const canUpload = receiptUrl ? canReplace : canAttach;
  const viewUrl = receiptUrl ? receiptViewUrl(receiptUrl) : null;

  const choose = () => {
    if (receiptUrl && !window.confirm('رسید فعلی این تراکنش با فایل تازه عوض شود؟')) return;
    input.current?.click();
  };

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    const uploaded = await uploadReceiptFile(file);
    if ('error' in uploaded) {
      setBusy(false);
      toast.error(uploaded.error);
      return;
    }
    const result = await attachReceipt(transactionId, uploaded.ref);
    setBusy(false);
    if (result.success) {
      toast.success(result.message);
      router.refresh();
    } else {
      toast.error(result.message);
      deleteReceipt(uploaded.ref).catch(() => {});
    }
  };

  return (
    <span className="inline-flex items-center gap-1">
      {receiptUrl &&
        (viewUrl ? (
          <a
            href={viewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center h-8 w-8 rounded-full hover:bg-muted"
            title="مشاهده رسید"
          >
            {isPdfReceipt(receiptUrl) ? (
              <FileText className="h-4 w-4 text-red-500" />
            ) : (
              <ImageIcon className="h-4 w-4 text-blue-500" />
            )}
          </a>
        ) : (
          <span className="inline-flex h-8 w-8 items-center justify-center" title="این پیوست فایل رسید معتبری نیست">
            <FileX className="h-4 w-4 text-muted-foreground" />
          </span>
        ))}
      {canUpload && (
        <>
          <input ref={input} type="file" className="hidden" accept="image/*,application/pdf" onChange={upload} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={choose}
            disabled={busy}
            title={receiptUrl ? 'تعویض رسید' : 'آپلود رسید'}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : receiptUrl ? (
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Paperclip className="h-4 w-4" />
            )}
          </Button>
        </>
      )}
      {!receiptUrl && !canUpload && <span className="text-muted-foreground text-xs">-</span>}
    </span>
  );
}
