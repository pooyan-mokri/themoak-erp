'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, X, FileText, Loader2 } from 'lucide-react';
import { deleteReceipt } from '@/actions/upload';
import { isPdfReceipt, isReceiptRef, receiptViewUrl } from '@/lib/receipt-ref';
import { uploadReceiptFile } from '@/components/accounting/upload-receipt-file';
import { toast } from 'sonner';

interface ReceiptUploadProps {
  onUploadComplete: (url: string, type: string) => void;
  onRemove: () => void;
  currentUrl?: string;
  currentType?: string;
}

/** Picks a receipt for a form; the form saves the reference on the row it records. */
export function ReceiptUpload({ onUploadComplete, onRemove, currentUrl }: ReceiptUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsUploading(true);
    const uploaded = await uploadReceiptFile(file);
    setIsUploading(false);
    if ('error' in uploaded) {
      toast.error(uploaded.error);
    } else {
      onUploadComplete(uploaded.ref, uploaded.type);
      toast.success('رسید آپلود شد');
    }
  };

  const handleRemove = async () => {
    // Not saved on a row yet, so the file goes too.
    if (currentUrl && isReceiptRef(currentUrl)) await deleteReceipt(currentUrl).catch(() => {});
    onRemove();
  };

  if (currentUrl) {
    const viewUrl = receiptViewUrl(currentUrl);
    return (
      <div className="relative border rounded-lg p-3 md:p-4 bg-muted/20 flex items-center gap-3 md:gap-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute -top-2 -right-2 h-8 w-8 md:h-6 md:w-6 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 touch-manipulation"
          onClick={handleRemove}
          title="حذف رسید"
        >
          <X className="h-5 w-5 md:h-4 md:w-4" />
        </Button>

        <div className="h-20 w-20 md:h-16 md:w-16 relative rounded overflow-hidden border bg-background flex items-center justify-center flex-shrink-0">
          {viewUrl && !isPdfReceipt(currentUrl) ? (
            // eslint-disable-next-line @next/next/no-img-element -- a private file behind the session, not optimisable
            <img src={viewUrl} alt="رسید" className="h-full w-full object-cover" />
          ) : (
            <FileText className="h-10 w-10 md:h-8 md:w-8 text-muted-foreground" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm md:text-xs font-medium">
            {isPdfReceipt(currentUrl) ? 'رسید (PDF)' : 'رسید (عکس)'}
          </p>
          {viewUrl && (
            <a
              href={viewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm md:text-xs text-primary hover:underline mt-2 inline-block"
            >
              مشاهده فایل
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*,application/pdf"
        onChange={handleFileChange}
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
        className="w-full border-dashed h-12 md:h-10 text-base md:text-sm"
      >
        {isUploading ? (
          <>
            <Loader2 className="ml-2 h-5 w-5 md:h-4 md:w-4 animate-spin" />
            در حال آپلود...
          </>
        ) : (
          <>
            <Upload className="ml-2 h-5 w-5 md:h-4 md:w-4" />
            آپلود رسید / فاکتور
          </>
        )}
      </Button>
    </div>
  );
}
