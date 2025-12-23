'use client';

import { postDepreciation } from '@/actions/fixed-assets';
import { Button } from '@/components/ui/button';
import { Calculator } from 'lucide-react';
import { useTransition } from 'react';
import { toast } from 'sonner';

export function PostDepreciationButton({ assetId }: { assetId: string }) {
  const [isPending, startTransition] = useTransition();

  const handlePost = () => {
    if (confirm('آیا از ثبت سند استهلاک برای این دارایی اطمینان دارید؟')) {
      startTransition(async () => {
        const result = await postDepreciation(assetId);
        if (result.success) {
          // We can use a toast library if available, or just alert for now
          alert(result.message);
        } else {
          alert(result.error);
        }
      });
    }
  };

  return (
    <Button 
      size="sm" 
      variant="outline" 
      onClick={handlePost} 
      disabled={isPending}
      title="ثبت استهلاک"
    >
      <Calculator className="w-4 h-4" />
    </Button>
  );
}
