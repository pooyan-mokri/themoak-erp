import { notFound } from 'next/navigation';
import { getCompanyInfo } from '@/actions/settings';
import { InvoiceDocument } from '@/components/sales/invoice-document';
import { loadInvoiceData } from '@/lib/invoice-data';
import { requireRouteAccess } from '@/lib/access';

export default async function PrintOrderPage({ params }: { params: { id: string } }) {
  await requireRouteAccess('/dashboard/sales');
  const data = await loadInvoiceData(params.id);
  if (!data) {
    notFound();
  }
  const companyInfo = await getCompanyInfo();
  return <InvoiceDocument data={data} company={companyInfo as any} />;
}
