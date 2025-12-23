'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Upload, X, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { uploadProductImage, deleteProductImage } from '@/actions/upload';
import { toast } from 'sonner';

interface ProductImageUploadProps {
  onUploadComplete: (url: string) => void;
  onRemove: () => void;
  currentUrl?: string | null;
}

export function ProductImageUpload({ onUploadComplete, onRemove, currentUrl }: ProductImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('حجم فایل نباید بیشتر از 10 مگابایت باشد');
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const result = await uploadProductImage(formData);
      
      if (result.success && result.url) {
        onUploadComplete(result.url);
        toast.success('عکس با موفقیت آپلود شد');
      } else {
        toast.error(result.error || 'خطا در آپلود عکس');
      }
    } catch (error) {
      toast.error('خطا در ارتباط با سرور');
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
      try {
        await deleteProductImage(currentUrl);
      } catch (error) {
        console.error('Error deleting image:', error);
      }
    }
    onRemove();
  };

  if (currentUrl && currentUrl.trim()) {
    return (
      <div className="space-y-2">
        <Label>عکس کالا</Label>
        <div className="relative border rounded-lg p-4 bg-muted/20 flex items-center gap-4">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={handleRemove}
          >
            <X className="h-4 w-4" />
          </Button>
          
          <div className="h-24 w-24 relative rounded overflow-hidden border bg-background flex items-center justify-center">
            {currentUrl.startsWith('/uploads/') ? (
              // Use regular img tag for local uploads
              <img
                src={currentUrl}
                alt="Product"
                className="w-full h-full object-cover"
              />
            ) : (
              // Use Next.js Image for external URLs
              <Image 
                src={currentUrl} 
                alt="Product" 
                fill 
                className="object-cover"
              />
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              عکس کالا
            </p>
            <a 
              href={currentUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline mt-1 inline-block"
            >
              مشاهده عکس
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label>عکس کالا (اختیاری)</Label>
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        onChange={handleFileChange}
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
        className="w-full border-dashed"
      >
        {isUploading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            در حال آپلود...
          </>
        ) : (
          <>
            <Upload className="mr-2 h-4 w-4" />
            آپلود عکس کالا
          </>
        )}
      </Button>
    </div>
  );
}

