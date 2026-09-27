import { prisma } from '@/lib/prisma';
import { orderMoney } from '@/lib/return-math';
import { buildInvoice, type InvoiceBill, type InvoiceSourceItem } from '@/lib/invoice-lines';
import { formatShipTo, readSiteOrderData } from '@/lib/site-sale-data';

/**
 * Everything a sale's invoice shows, read once for its page and both prints
 * (the order's «چاپ فاکتور» and the invoice's print).
 *
 * No permission check here: the pages that call it check route access.
 * Returns no cost price and no account balance.
 */
export type InvoiceData = {
  orderId: string;
  orderNumber: number;
  orderDate: Date;
  invoice: {
    id: string;
    invoiceNumber: string;
    issueDate: Date;
    dueDate: Date;
    status: string;
  } | null;
  customer: { id: string; name: string; phone: string | null } | null;
  buyerAddress: string;
  shipNote: string | null;
  /** The account whose card and IBAN a credit sale's invoice shows. */
  invoiceAccount: { name: string; cardNumber: string | null; sheba: string | null } | null;
  bill: InvoiceBill;
};

export async function loadInvoiceData(orderId: string): Promise<InvoiceData | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: { select: { id: true, name: true, phone: true, address: true } },
      invoice: { select: { id: true, invoiceNumber: true, issueDate: true, dueDate: true, status: true } },
      invoiceAccount: { select: { name: true, cardNumber: true, sheba: true } },
      commissions: { select: { commissionRate: true, isPaid: true } },
      siteRefunds: { select: { amount: true } },
      items: {
        // cuids grow with time: the lines in the order they were added.
        orderBy: { id: 'asc' },
        include: {
          product: { select: { name: true } },
          returns: { select: { quantity: true } },
          exchanges: { select: { quantity: true, exchangeItemId: true }, orderBy: { createdAt: 'asc' } },
          exchangeItems: { select: { originalItem: { select: { product: { select: { name: true } } } } } },
        },
      },
    },
  });
  if (!order) return null;

  const items: InvoiceSourceItem[] = order.items.map((item: any) => ({
    id: item.id,
    name: item.product.name,
    quantity: item.quantity,
    price: Number(item.price),
    returned: item.returns.reduce((sum: number, row: any) => sum + row.quantity, 0),
    exchangedAway: item.exchanges.reduce((sum: number, row: any) => sum + row.quantity, 0),
    issuedIds: item.exchanges.map((row: any) => row.exchangeItemId),
    replaced: item.exchangeItems[0]?.originalItem?.product?.name,
  }));

  // A website order: its total includes the freight and has the website's refunds taken off.
  const siteData = order.siteReference ? readSiteOrderData(order.siteData) : null;
  const freight =
    siteData?.shipping && siteData.shipping.free !== true ? Number(siteData.shipping.freight || 0) : 0;
  const siteRefunded = order.siteReference
    ? order.siteRefunds.reduce((sum: number, refund: any) => sum + Number(refund.amount), 0)
    : 0;

  const bill = buildInvoice({
    totalAmount: Number(order.totalAmount),
    discount: Number(order.discount),
    paidAmount: Number(order.paidAmount),
    wooId: order.wooId,
    siteReference: order.siteReference,
    freight,
    siteRefunded,
    commissionRate: orderMoney(order).commissionRate,
    customerCredit: 0,
    items,
  });

  return {
    orderId: order.id,
    orderNumber: order.number,
    orderDate: order.createdAt,
    invoice: order.invoice,
    customer: order.customer ? { id: order.customer.id, name: order.customer.name, phone: order.customer.phone } : null,
    buyerAddress: (siteData && formatShipTo(siteData.shipTo)) || order.customer?.address || '-',
    shipNote: siteData?.shipTo?.note ?? null,
    invoiceAccount: order.invoiceAccount,
    bill,
  };
}

/** The order an invoice bills. */
export async function invoiceOrderId(invoiceId: string): Promise<string | null> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { orderId: true } });
  return invoice?.orderId ?? null;
}
