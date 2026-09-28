import { orderTotals } from '@/lib/order-balance';

/**
 * What a sale's invoice shows, line by line and in its money rows: the same
 * figures on the order's «چاپ فاکتور», the invoice print and the invoice page
 * (src/lib/invoice-data.ts loads them, src/components/sales/invoice-document.tsx
 * renders them).
 *
 * Deliberately not a 'use server' file: plain functions, used on both sides.
 */

export type InvoiceSourceItem = {
  id: string;
  name: string;
  quantity: number;
  /** Unit price as sold (gross of a consignment partner's commission). */
  price: number;
  /** Units given back. */
  returned: number;
  /** Units exchanged away. */
  exchangedAway: number;
  /** The lines this line's exchanges issued in its place, in order. */
  issuedIds: string[];
  /** For a line an exchange issued: the name of the product it replaced. */
  replaced?: string;
};

export type InvoiceSource = {
  totalAmount: number;
  discount: number;
  paidAmount: number;
  wooId?: number | null;
  siteReference?: string | null;
  /** A website order's freight, part of its total. */
  freight: number;
  /** What the website refunded, already taken off its total. */
  siteRefunded: number;
  /** The partner's commission in percent when the total is stored net of it (orderMoney), else 0. */
  commissionRate: number;
  /** The customer's credit balance. */
  customerCredit: number;
  items: InvoiceSourceItem[];
};

export type InvoiceLineKind = 'SOLD' | 'RETURNED' | 'EXCHANGED';

export type InvoiceLine = {
  key: string;
  kind: InvoiceLineKind;
  name: string;
  /** «برگشتی», «تعویض», or what an exchange line replaced. */
  note?: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  /** Only units still sold add up to جمع کالا; returned and exchanged units are shown, not counted. */
  counted: boolean;
};

export type InvoiceMoneyRow = {
  key: 'goods' | 'freight' | 'siteRefunded' | 'commission' | 'discount' | 'net' | 'paid' | 'remaining' | 'credit' | 'customerCredit';
  label: string;
  amount: number;
  /** Shown with a minus: taken off the row above. */
  deduction?: boolean;
  strong?: boolean;
};

export type InvoiceBill = {
  lines: InvoiceLine[];
  goodsTotal: number;
  freight: number;
  siteRefunded: number;
  commission: number;
  discount: number;
  net: number;
  paid: number;
  remaining: number;
  /** Paid beyond the net on this order («بستانکار»). */
  credit: number;
  customerCredit: number;
  rows: InvoiceMoneyRow[];
};

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  PAID: 'پرداخت شده',
  PARTIAL: 'پرداخت ناقص',
  UNPAID: 'پرداخت نشده',
  OVERDUE: 'سررسید گذشته',
  CANCELLED: 'لغو شده',
};

export function invoiceStatusLabel(status: string): string {
  return INVOICE_STATUS_LABELS[status] ?? status;
}

/**
 * The invoice of one order:
 * - each line at the units still sold;
 * - units given back as their own «برگشتی» line, units exchanged away as a
 *   «تعویض» line, both shown but not counted;
 * - the lines an exchange issued right after the line they replaced, named
 *   with what they replaced;
 * - the money rows, from the order's stored totals, which add up:
 *   جمع کالا + ارسال − بازپرداخت سایت − کمیسیون − تخفیف = مبلغ قابل پرداخت,
 *   and مبلغ قابل پرداخت − پرداخت‌شده = باقی‌مانده (or − بستانکار).
 */
export function buildInvoice(source: InvoiceSource): InvoiceBill {
  const byId = new Map(source.items.map((item) => [item.id, item]));
  const lines: InvoiceLine[] = [];
  const shown = new Set<string>();

  const emit = (item: InvoiceSourceItem) => {
    if (shown.has(item.id)) return;
    shown.add(item.id);
    const sold = Math.max(0, item.quantity - item.returned - item.exchangedAway);
    const line = (kind: InvoiceLineKind, quantity: number, note: string | undefined, counted: boolean) =>
      lines.push({
        key: `${item.id}:${kind}`,
        kind,
        name: item.name,
        note,
        quantity,
        unitPrice: item.price,
        amount: item.price * quantity,
        counted,
      });
    const replaced = item.replaced ? `به‌جای ${item.replaced} (تعویض)` : undefined;
    if (sold > 0) line('SOLD', sold, replaced, true);
    if (item.returned > 0) line('RETURNED', item.returned, replaced ? `برگشتی؛ ${replaced}` : 'برگشتی', false);
    if (item.exchangedAway > 0) line('EXCHANGED', item.exchangedAway, 'تعویض', false);
    for (const id of item.issuedIds) {
      const issued = byId.get(id);
      if (issued) emit(issued);
    }
  };

  const issued = new Set(source.items.flatMap((item) => item.issuedIds));
  for (const item of source.items) if (!issued.has(item.id) && !item.replaced) emit(item);
  // A line issued by an exchange whose original line is not on the order.
  for (const item of source.items) emit(item);

  const totals = orderTotals(source);
  const linesGross = lines.reduce((sum, line) => sum + (line.counted ? line.amount : 0), 0);
  const commission = source.commissionRate > 0 ? (linesGross * source.commissionRate) / 100 : 0;
  const goodsTotal = totals.gross - source.freight + source.siteRefunded + commission;

  const rows: InvoiceMoneyRow[] = [{ key: 'goods', label: 'جمع کالا', amount: goodsTotal }];
  if (source.freight > 0) rows.push({ key: 'freight', label: 'هزینهٔ ارسال', amount: source.freight });
  if (source.siteRefunded > 0) {
    rows.push({ key: 'siteRefunded', label: 'بازپرداخت سایت', amount: source.siteRefunded, deduction: true });
  }
  if (commission > 0) rows.push({ key: 'commission', label: 'کمیسیون همکار', amount: commission, deduction: true });
  if (totals.discount > 0) rows.push({ key: 'discount', label: 'تخفیف', amount: totals.discount, deduction: true });
  rows.push({ key: 'net', label: 'مبلغ قابل پرداخت', amount: totals.net, strong: true });
  rows.push({ key: 'paid', label: 'پرداخت‌شده', amount: totals.paid });
  if (totals.credit > 0) rows.push({ key: 'credit', label: 'بستانکار', amount: totals.credit, strong: true });
  else rows.push({ key: 'remaining', label: 'باقی‌مانده', amount: totals.remaining, strong: true });
  if (source.customerCredit > 0) {
    rows.push({ key: 'customerCredit', label: 'اعتبار فعلی مشتری', amount: source.customerCredit });
  }

  return {
    lines,
    goodsTotal,
    freight: source.freight,
    siteRefunded: source.siteRefunded,
    commission,
    discount: totals.discount,
    net: totals.net,
    paid: totals.paid,
    remaining: totals.remaining,
    credit: totals.credit,
    customerCredit: source.customerCredit,
    rows,
  };
}
