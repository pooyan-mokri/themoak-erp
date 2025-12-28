import React from 'react';
import { prisma } from '@/lib/prisma';
import { getCompanyInfo } from '@/actions/settings';
import { getOrderReturns } from '@/actions/order-return';
import { getOrderExchanges } from '@/actions/order-exchange';
import { notFound } from 'next/navigation';
import { formatJalaliDate } from '@/lib/date-utils';
import { PrintOrderActions } from '@/components/sales/print-order-actions';

export default async function PrintOrderPage({ params }: { params: { id: string } }) {
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      items: {
        include: {
          product: true,
        },
      },
      transaction: true,
    },
  });

  if (!order) {
    notFound();
  }

  const companyInfo = await getCompanyInfo();
  
  // Get exchanges and returns for this order (with error handling)
  let exchanges: any[] = [];
  let returns: any[] = [];
  try {
    exchanges = await getOrderExchanges(params.id);
  } catch (error) {
    console.error('Error fetching exchanges:', error);
  }
  try {
    returns = await getOrderReturns(params.id);
  } catch (error) {
    console.error('Error fetching returns:', error);
  }

  // Build items list with exchanges and status
  const itemsWithDetails = order.items.map((item: any) => {
    const itemExchanges = (exchanges || []).filter((ex: any) => ex?.originalItem?.id === item.id);
    const itemReturns = (returns || []).filter((ret: any) => ret?.orderItem?.id === item.id);
    return {
      ...item,
      exchanges: itemExchanges || [],
      returns: itemReturns || [],
    };
  });

  // Calculate subtotal considering returns and exchanges
  // Start with original order total
  let subtotal = Number(order.totalAmount);
  
  // Subtract returned amounts
  const totalReturns = (returns || []).reduce((sum: any, ret: any) => {
    return sum + Number(ret.refundAmount || 0);
  }, 0);
  
  // Add exchange price differences (can be positive or negative)
  const totalExchangeDiff = (exchanges || []).reduce((sum: any, ex: any) => {
    return sum + Number(ex.priceDifference || 0);
  }, 0);
  
  // Final subtotal = original total - returns + exchange differences
  subtotal = subtotal - totalReturns + totalExchangeDiff;
  
  const discountAmount = Number(order.discount || 0);
  const finalAmount = subtotal - discountAmount;

  return (
    <div className="bg-white min-h-screen p-8 text-black print:p-0">
      <div className="max-w-4xl mx-auto print:w-full print:max-w-none" id="invoice-content">
        {/* Print and Download Buttons */}
        <PrintOrderActions orderNumber={order.number} invoiceContentId="invoice-content" />

        {/* Header */}
        <div className="flex justify-between items-start border-b pb-6 mb-6">
          <div className="flex items-center gap-4">
            {companyInfo?.logo ? (
              <img 
                src={companyInfo.logo} 
                alt="Logo" 
                className="h-24 w-auto object-contain print:h-20"
              />
            ) : null}
            <div>
              <h1 className="text-2xl font-bold">{companyInfo?.name || 'نام شرکت'}</h1>
              <p className="text-sm text-gray-600 mt-1">{companyInfo?.phone}</p>
              <p className="text-sm text-gray-600">{companyInfo?.address}</p>
            </div>
          </div>
          <div className="text-left">
            <h2 className="text-xl font-bold mb-2">فاکتور فروش</h2>
            <p className="text-sm">شماره: {order.number}</p>
            <p className="text-sm">تاریخ: {formatJalaliDate(order.createdAt)}</p>
          </div>
        </div>

        {/* Customer Info */}
        <div className="mb-8 p-4 bg-gray-50 rounded-lg border print:border-gray-300">
          <h3 className="font-bold mb-2 text-gray-700">مشخصات خریدار</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <p><span className="text-gray-500 ml-2">نام:</span> {order.customer?.name || 'مشتری عمومی'}</p>
            <p><span className="text-gray-500 ml-2">تلفن:</span> {order.customer?.phone || '-'}</p>
            <p className="col-span-2"><span className="text-gray-500 ml-2">آدرس:</span> {order.customer?.address || '-'}</p>
          </div>
        </div>

        {/* Items Table */}
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
            {itemsWithDetails.map((item: any, index: any) => (
              <React.Fragment key={item.id}>
                <tr className="border-b border-gray-200">
                  <td className="py-2">{index + 1}</td>
                  <td className="py-2">
                    {item.product.name}
                    {(item.status || 'PENDING') === 'RETURNED' && (
                      <span className="text-red-600 text-xs mr-2">(عودت شده)</span>
                    )}
                    {(item.status || 'PENDING') === 'EXCHANGED' && (
                      <span className="text-blue-600 text-xs mr-2">(تعویض شده)</span>
                    )}
                  </td>
                  <td className="text-center py-2">{item.quantity}</td>
                  <td className="text-left py-2">{Number(item.price).toLocaleString()}</td>
                  <td className="text-left py-2">{(Number(item.price) * item.quantity).toLocaleString()}</td>
                </tr>
                {item.exchanges && item.exchanges.length > 0 && item.exchanges.map((ex: any) => (
                  <tr key={`ex-${ex.id}`} className="border-b border-gray-100 bg-blue-50">
                    <td className="py-2"></td>
                    <td className="py-2 text-blue-700">
                      → {ex.exchangeItem?.product?.name || 'نامشخص'} (تعویض)
                    </td>
                    <td className="text-center py-2">{ex.quantity}</td>
                    <td className="text-left py-2">{Number(ex.exchangeItem?.price || 0).toLocaleString()}</td>
                    <td className="text-left py-2">{(Number(ex.exchangeItem?.price || 0) * ex.quantity).toLocaleString()}</td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="text-left py-2 pl-4">جمع کل:</td>
              <td className="text-left py-2">{subtotal.toLocaleString()} تومان</td>
            </tr>
            {discountAmount > 0 && (
              <tr>
                <td colSpan={4} className="text-left py-2 pl-4 text-red-600">تخفیف:</td>
                <td className="text-left py-2 text-red-600">-{discountAmount.toLocaleString()} تومان</td>
              </tr>
            )}
            <tr className="font-bold text-lg border-t-2 border-gray-800">
              <td colSpan={4} className="text-left py-4 pl-4">مبلغ قابل پرداخت:</td>
              <td className="text-left py-4">{finalAmount.toLocaleString()} تومان</td>
            </tr>
          </tfoot>
        </table>

        {/* Footer */}
        <div className="border-t pt-6 text-center text-sm text-gray-500">
          <p>از خرید شما سپاسگزاریم</p>
        </div>
      </div>
    </div>
  );
}
