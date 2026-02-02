'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, X, FileText, Image as ImageIcon, Loader2 } from 'lucide-react';
import Image from 'next/image';
import {
  uploadReceipt,
  deleteReceipt,
  getReceiptViewUrl,
} from '@/actions/upload';
import { toast } from 'sonner';

interface ReceiptUploadProps {
  onUploadComplete: (url: string, type: string) => void;
  onRemove: () => void;
  currentUrl?: string;
  currentType?: string;
}

export function ReceiptUpload({
  onUploadComplete,
  onRemove,
  currentUrl,
  currentType,
}: ReceiptUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [viewUrl, setViewUrl] = useState<string>('');
  const [isFTP, setIsFTP] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (currentUrl) {
      if (currentUrl.startsWith('ftp:')) {
        setIsFTP(true);
        // For FTP files, you may need to construct a web-accessible URL
        // This depends on your FTP server setup
        // For now, we'll just show the path
        setViewUrl(currentUrl);
      } else {
        setIsFTP(false);
        setViewUrl(currentUrl);
      }
    }
  }, [currentUrl]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('حجم فایل نباید بیشتر از 5 مگابایت باشد');
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const result = await uploadReceipt(formData);

      if (result.success && result.url && result.type) {
        onUploadComplete(result.url, result.type);
        toast.success('فایل با موفقیت آپلود شد');
      } else {
        const errorMsg = result.error || 'خطا در آپلود فایل';
        console.error('[ReceiptUpload] Upload failed:', errorMsg);
        toast.error(errorMsg);
      }
    } catch (error: any) {
      console.error('[ReceiptUpload] Upload exception:', error);
      toast.error(error?.message || 'خطا در ارتباط با سرور');
    } finally {
      setIsUploading(false);
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemove = async () => {
    if (currentUrl) {
      // Optional: Delete from server when removed from UI
      // For now, we just remove from UI state.
      // In a real app, you might want to delete only when form is submitted or have a cleanup job.
      // But let's try to delete it to keep things clean.
      await deleteReceipt(currentUrl);
    }
    onRemove();
  };

  if (currentUrl) {
    return (
      <div className="relative border rounded-lg p-3 md:p-4 bg-muted/20 flex items-center gap-3 md:gap-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute -top-2 -right-2 h-8 w-8 md:h-6 md:w-6 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 touch-manipulation"
          onClick={handleRemove}
        >
          <X className="h-5 w-5 md:h-4 md:w-4" />
        </Button>

        <div className="h-20 w-20 md:h-16 md:w-16 relative rounded overflow-hidden border bg-background flex items-center justify-center flex-shrink-0">
          {currentType?.startsWith('image/') && !isFTP ? (
            <Image
              src={viewUrl}
              alt="Receipt"
              fill
              className="object-cover"
            />
          ) : (
            <FileText className="h-10 w-10 md:h-8 md:w-8 text-muted-foreground" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm md:text-xs font-medium truncate">
            {isFTP ? 'فایل FTP' : currentUrl.split('/').pop()}
          </p>
          <p className="text-xs md:text-[10px] text-muted-foreground mt-1">
            {currentType === 'application/pdf' ? 'سند PDF' : 'تصویر'}
            {isFTP && ' • FTP'}
          </p>
          <a
            href={viewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm md:text-xs text-primary hover:underline mt-2 inline-block"
          >
            مشاهده فایل
          </a>
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
        accept="image/jpeg,image/png,application/pdf"
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
