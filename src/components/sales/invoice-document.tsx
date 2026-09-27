import React from 'react';
import { formatJalaliDate } from '@/lib/date-utils';
import { PrintOrderActions } from '@/components/sales/print-order-actions';
import type { InvoiceBill, InvoiceLine } from '@/lib/invoice-lines';
import type { InvoiceData } from '@/lib/invoice-data';

/**
 * A sale's invoice, from loadInvoiceData (src/lib/invoice-data.ts). The order's
 * «چاپ فاکتور» and the invoice's print render InvoiceDocument; the invoice
 * page renders InvoiceTable. Plain components (no hooks, not async), so the
 * same figures print, show and can be rendered in tests.
 */

const toman = (amount: number) => Math.round(amount).toLocaleString('fa-IR');

const NOTE_CLASS: Record<InvoiceLine['kind'], string> = {
  SOLD: 'text-blue-600',
  RETURNED: 'text-red-600',
  EXCHANGED: 'text-blue-600',
};

/** The lines and, in its footer, the money rows. */
export function InvoiceTable({ bill }: { bill: InvoiceBill }) {
  return (
    <table className="w-full mb-8 text-sm">
      <thead>
        <tr className="border-b-2 border-gray-800">
          <th className="text-right py-2">#</th>
          <th className="text-right py-2">شرح کالا</th>
          <th className="text-center py-2">تعداد</th>
          <th className="text-left py-2">قیمت واحد</th>
          <th className="text-left py-2">قیمت کل</th>
        </tr>
      </thead>
      <tbody>
        {bill.lines.map((line, index) => (
          <tr
            key={line.key}
            data-line={line.kind}
            data-counted={line.counted ? '1' : '0'}
            data-amount={Math.round(line.amount)}
            className={line.counted ? 'border-b border-gray-200' : 'border-b border-gray-100 bg-gray-50 text-gray-500'}
          >
            <td className="py-2">{index + 1}</td>
            <td className="py-2">
              {line.name}
              {line.note && <span className={`${NOTE_CLASS[line.kind]} text-xs mr-2`}>({line.note})</span>}
            </td>
            <td className="text-center py-2">{line.quantity.toLocaleString('fa-IR')}</td>
            <td className="text-left py-2">{toman(line.unitPrice)}</td>
            <td className="text-left py-2">
              {line.counted ? toman(line.amount) : <span className="line-through">{toman(line.amount)}</span>}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        {bill.rows.map((row) => {
          const pad = row.key === 'net' ? 'py-4' : 'py-2';
          const tone = row.deduction ? ' text-red-600' : row.key === 'credit' ? ' text-green-700' : '';
          return (
          <tr
            key={row.key}
            data-row={row.key}
            data-amount={Math.round(row.amount)}
            className={
              row.key === 'net'
                ? 'font-bold text-lg border-t-2 border-gray-800'
                : row.key === 'customerCredit'
                  ? 'border-t border-gray-200 text-gray-600'
                  : row.strong
                    ? 'font-bold'
                    : undefined
            }
          >
            <td colSpan={4} className={`text-left pl-4 ${pad}${tone}`}>
              {row.label}:
            </td>
            <td className={`text-left ${pad}${tone}`}>
              {row.deduction ? '-' : ''}
              {toman(row.amount)} تومان
            </td>
          </tr>
          );
        })}
      </tfoot>
    </table>
  );
}

type CompanyInfo = { name?: string; phone?: string; address?: string; logo?: string } | null | undefined;

/** The printed invoice: header, buyer, lines, money rows, the account for a credit sale. */
export function InvoiceDocument({
  data,
  company,
  autoPrint = false,
}: {
  data: InvoiceData;
  company: CompanyInfo;
  autoPrint?: boolean;
}) {
  const account = data.invoiceAccount;
  return (
    <div className="bg-white min-h-screen p-8 text-black print:p-0">
      <div className="max-w-4xl mx-auto print:w-full print:max-w-none" id="invoice-content">
        {/* Print and Download Buttons */}
        <PrintOrderActions orderNumber={data.orderNumber} invoiceContentId="invoice-content" />

        {/* Header */}
        <div className="flex justify-between items-start border-b pb-6 mb-6">
          <div className="flex items-center gap-4">
            {company?.logo ? (
              <img src={company.logo} alt="Logo" className="h-24 w-auto object-contain print:h-20" />
            ) : null}
            <div>
              <h1 className="text-2xl font-bold">{company?.name || 'نام شرکت'}</h1>
              <p className="text-sm text-gray-600 mt-1">{company?.phone}</p>
              <p className="text-sm text-gray-600">{company?.address}</p>
            </div>
          </div>
          <div className="text-left">
            <h2 className="text-xl font-bold mb-2">فاکتور فروش</h2>
            <p className="text-sm">شماره: {data.orderNumber}</p>
            {data.invoice && <p className="text-sm">شماره فاکتور: {data.invoice.invoiceNumber}</p>}
            <p className="text-sm">تاریخ: {formatJalaliDate(data.orderDate)}</p>
          </div>
        </div>

        {/* Customer Info */}
        <div className="mb-8 p-4 bg-gray-50 rounded-lg border print:border-gray-300">
          <h3 className="font-bold mb-2 text-gray-700">مشخصات خریدار</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <p><span className="text-gray-500 ml-2">نام:</span> {data.customer?.name || 'مشتری عمومی'}</p>
            <p><span className="text-gray-500 ml-2">تلفن:</span> {data.customer?.phone || '-'}</p>
            <p className="col-span-2"><span className="text-gray-500 ml-2">آدرس:</span> {data.buyerAddress}</p>
            {data.shipNote && (
              <p className="col-span-2"><span className="text-gray-500 ml-2">یادداشت ارسال:</span> {data.shipNote}</p>
            )}
          </div>
        </div>

        <InvoiceTable bill={data.bill} />

        {/* Bank account info for credit sales */}
        {account && (account.cardNumber || account.sheba) && (
          <div className="mb-6 p-4 border border-blue-200 rounded-lg bg-blue-50 print:bg-blue-50">
            <h4 className="font-bold text-sm text-blue-800 mb-2">اطلاعات واریز (فروش نسیه)</h4>
            <div className="space-y-1 text-sm" dir="ltr">
              {account.cardNumber && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 text-xs">شماره کارت:</span>
                  <span className="font-mono tracking-widest text-blue-900 font-bold">{account.cardNumber}</span>
                </div>
              )}
              {account.sheba && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 text-xs">شبا:</span>
                  <span className="font-mono text-[12px] text-blue-900">{account.sheba}</span>
                </div>
              )}
              <div className="text-xs text-gray-500 mt-1">به نام: {account.name}</div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t pt-6 text-center text-sm text-gray-500">
          <p>از خرید شما سپاسگزاریم</p>
        </div>
      </div>
      {autoPrint && <script dangerouslySetInnerHTML={{ __html: 'window.print();' }} />}
    </div>
  );
}
