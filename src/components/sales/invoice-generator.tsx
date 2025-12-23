'use client';

import { createInvoiceFromOrder } from '@/actions/invoice';
import { Button } from '@/components/ui/button';
import { FileText } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

interface InvoiceGeneratorProps {
  orderId: string;
  disabled?: boolean;
}

export function InvoiceGenerator({ orderId, disabled }: InvoiceGeneratorProps) {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleGenerate = async () => {
    setIsLoading(true);
    try {
      const result = await createInvoiceFromOrder(orderId);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
        if (result.invoiceId) {
            router.push(`/dashboard/sales/invoices/${result.invoiceId}`);
        }
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      toast.error('خطا در ایجاد فاکتور');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button 
      onClick={handleGenerate} 
      disabled={disabled || isLoading}
      variant="outline"
      className="gap-2"
    >
      <FileText className="h-4 w-4" />
      {isLoading ? 'در حال ایجاد...' : 'صدور فاکتور'}
    </Button>
  );
}
