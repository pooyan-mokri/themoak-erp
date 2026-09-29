import { notFound } from 'next/navigation';
import { getCompanyInfo } from '@/actions/settings';
import { InvoiceDocument } from '@/components/sales/invoice-document';
import { invoiceOrderId, loadInvoiceData } from '@/lib/invoice-data';
import { requireRouteAccess } from '@/lib/access';

// The same invoice as the order's «چاپ فاکتور» (src/components/sales/invoice-document.tsx).
export default async function PrintInvoicePage({ params }: { params: { id: string } }) {
  await requireRouteAccess('/dashboard/sales');
  const orderId = await invoiceOrderId(params.id);
  const data = orderId ? await loadInvoiceData(orderId) : null;
  if (!data) {
    notFound();
  }
  const companyInfo = await getCompanyInfo();
  return <InvoiceDocument data={data} company={companyInfo as any} autoPrint />;
}
