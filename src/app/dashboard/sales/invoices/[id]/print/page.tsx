import { getInvoiceById } from '@/actions/invoice';
import { notFound } from 'next/navigation';

import { formatJalaliDate } from '@/lib/date-utils';
export default async function PrintInvoicePage({ params }: { params: { id: string } }) {
  const invoice = await getInvoiceById(params.id);

  if (!invoice) {
    notFound();
  }

  return (
    <div className="p-8 max-w-[210mm] mx-auto bg-white text-black print:p-0">
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-2xl font-bold mb-2">فاکتور فروش</h1>
          <p className="text-sm">شماره: {invoice.invoiceNumber}</p>
          <p className="text-sm">تاریخ: {formatJalaliDate(invoice.issueDate)}</p>
        </div>
        <div className="text-left">
          <h2 className="text-xl font-bold">TheMoak</h2>
          <p className="text-sm">تهران، ...</p>
          <p className="text-sm">تلفن: ...</p>
        </div>
      </div>

      <div className="mb-8 p-4 border rounded-md">
        <h3 className="font-bold mb-2">مشخصات خریدار</h3>
        <p>نام: {invoice.customer.name}</p>
        <p>تلفن: {invoice.customer.phone || '-'}</p>
        <p>آدرس: {invoice.customer.address || '-'}</p>
      </div>

      <table className="w-full mb-8 border-collapse">
        <thead>
          <tr className="border-b-2 border-black">
            <th className="text-right py-2">شرح کالا</th>
            <th className="text-center py-2">تعداد</th>
            <th className="text-left py-2">فی</th>
            <th className="text-left py-2">مبلغ کل</th>
          </tr>
        </thead>
        <tbody>
          {/* Invoice items would go here. Currently Invoice model doesn't have direct items, 
              it links to Order which has items. 
              We need to fetch order items if we want to show them.
              The getInvoiceById includes order -> items.
          */}
          {invoice.order?.items.map((item: any) => (
            <tr key={item.id} className="border-b border-gray-200">
              <td className="py-2">{item.product.name}</td>
              <td className="text-center py-2">{item.quantity}</td>
              <td className="text-left py-2">{new Intl.NumberFormat('fa-IR').format(Number(item.price))}</td>
              <td className="text-left py-2">{new Intl.NumberFormat('fa-IR').format(Number(item.price) * item.quantity)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="text-left font-bold py-2 pt-4">جمع کل</td>
            <td className="text-left font-bold py-2 pt-4">{new Intl.NumberFormat('fa-IR').format(Number(invoice.total))} تومان</td>
          </tr>
        </tfoot>
      </table>

      <div className="text-center text-sm mt-12">
        <p>با تشکر از خرید شما</p>
      </div>

      <script dangerouslySetInnerHTML={{ __html: 'window.print();' }} />
    </div>
  );
}
