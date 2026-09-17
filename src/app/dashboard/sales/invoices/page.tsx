import { getInvoices } from '@/actions/invoice';
import { InvoiceList } from '@/components/sales/invoice-list';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { requireRouteAccess } from '@/lib/access';

export default async function InvoicesPage() {
  await requireRouteAccess('/dashboard/sales');
  const invoices = await getInvoices();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">فاکتورها</h2>
        {/* Invoices are usually generated from orders, but maybe manual creation is needed later */}
      </div>

      <InvoiceList invoices={invoices} />
    </div>
  );
}
