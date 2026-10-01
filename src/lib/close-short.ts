import { Prisma } from '@prisma/client';
import { additionalCostPerUnit, shortShipmentCredit } from '@/lib/landed-cost';

/** Why an order cannot be closed short, in Persian. */
export class CloseShortRefusal extends Error {}

export type CloseShortResult = {
  number: number;
  /** Units ordered and not received. */
  missing: number;
  /** The additional costs moved onto the units that came, in Toman. */
  respread: number;
  /** Credited to the supplier, in Toman. */
  credit: number;
  /** Products with nothing on hand to carry their share. */
  nothingOnHand: string[];
};

/**
 * Finish receiving a PARTIALLY_RECEIVED order with what came (a short shipment). Receipts cost each unit with
 * the order's additional costs (freight, customs, arrival costs) spread over the units ORDERED; closing short
 * re-spreads them over the units RECEIVED, so all of it reaches the cost of the units that came (Pooyan's
 * decision: 10 ordered, 200,000 freight, 8 received gives 25,000 a unit). This is the one point where that is
 * known: before it, the rest may still arrive. The part the missing units carried is added to each line's
 * received cost and to its product's cost of record, spread over the stock on hand; for a consumable, to its
 * asset's units. The order becomes RECEIVED.
 *
 * What was paid beyond the value of the units that came (shortShipmentCredit) becomes a credit with the
 * supplier («طلب از تأمین‌کننده»), as a cancel's payments do: once per order (its key is unique), under the same
 * lock as a cancel, the order row. expectedCredit is the amount the confirmation named; if it differs, nothing
 * happens.
 *
 * Runs inside the caller's transaction `tx`: closePurchaseOrderShort (src/actions/supplier.ts) and the data fix
 * scripts/datafix-2026-10-01-close-po4-short.ts. Server only, not a server action.
 */
export async function closeShortInTransaction(
  tx: any,
  orderId: string,
  options: { expectedCredit?: number; userId?: string | null } = {},
): Promise<CloseShortResult> {
  // Hold the order: a receipt, a payment, a cancel or a second close waits, then finds it received.
  await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${orderId} FOR UPDATE`;
  const order = await tx.purchaseOrder.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { product: true } },
      additionalCosts: true,
      arrivalAdditionalCosts: true,
      payments: { select: { amount: true } },
    },
  });
  if (!order) throw new CloseShortRefusal('سفارش یافت نشد');
  if (order.status !== 'PARTIALLY_RECEIVED') {
    throw new CloseShortRefusal('فقط سفارشی که بخشی از آن دریافت شده، با کسری بسته می‌شود.');
  }

  const exchangeRates = await tx.exchangeRate.findMany({ orderBy: { date: 'desc' }, distinct: ['currency'] });
  const getExchangeRate = (currency: string) => {
    if (currency === 'TOMAN') return 1;
    const rate = exchangeRates.find((r: any) => r.currency === currency);
    if (!rate) {
      throw new CloseShortRefusal(`نرخ ارز برای ${currency} یافت نشد. لطفا ابتدا نرخ روز را در بخش حسابداری ثبت کنید.`);
    }
    return Number(rate.rateToToman);
  };

  const paid = order.payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
  const credit = shortShipmentCredit(order, paid, getExchangeRate);
  if (options.expectedCredit !== undefined && Math.abs(options.expectedCredit - credit) >= 1) {
    throw new CloseShortRefusal('پرداخت‌ها یا دریافت‌های این سفارش از وقتی صفحه باز شد تغییر کرده است؛ صفحه را تازه کنید و دوباره ببندید.');
  }

  let respread = 0;
  const nothingOnHand: string[] = [];
  for (const item of order.items) {
    if (item.receivedQuantity <= 0) continue;
    const extra =
      item.receivedQuantity *
      (additionalCostPerUnit(item, order, getExchangeRate, 'received') -
        additionalCostPerUnit(item, order, getExchangeRate, 'ordered'));
    if (Math.abs(extra) < 1e-9) continue;
    respread += extra;

    await tx.purchaseOrderItem.update({
      where: { id: item.id },
      data: { totalCostInToman: Number(item.totalCostInToman ?? 0) + extra },
    });

    const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId } });
    if (product.productType === 'SALEABLE' || product.productType === 'OTHER') {
      const stock = await tx.inventory.aggregate({ where: { productId: item.productId }, _sum: { quantity: true } });
      const onHand = Math.max(0, Number(stock._sum.quantity ?? 0));
      // With nothing on hand (all of it sold already) there is no stock left to carry it.
      if (onHand > 0) {
        await tx.product.update({
          where: { id: item.productId },
          data: { costPrice: new Prisma.Decimal(Number(product.costPrice) + extra / onHand) },
        });
      } else if (extra > 0) {
        nothingOnHand.push(product.name);
      }
    } else if (product.productType === 'CONSUMABLE') {
      const asset = await tx.fixedAsset.findUnique({ where: { productId: item.productId } });
      if (asset && (asset.quantity ?? 0) > 0) {
        const value = (asset.quantity ?? 0) * Number(asset.purchasePrice) + extra;
        await tx.fixedAsset.update({
          where: { id: asset.id },
          data: { purchasePrice: value / (asset.quantity ?? 1), currentValue: value },
        });
      }
    }
  }

  await tx.purchaseOrder.update({ where: { id: orderId }, data: { status: 'RECEIVED' } });
  if (credit > 0) {
    await tx.supplierCredit.create({
      data: {
        supplierId: order.supplierId,
        amount: credit,
        purchaseOrderId: orderId,
        reason: `کسری سفارش خرید #${order.number}`,
        userId: options.userId ?? null,
        clientRequestId: `po-short:${orderId}`,
      },
    });
  }
  const missing = order.items.reduce((sum: number, item: any) => sum + Math.max(0, item.quantity - item.receivedQuantity), 0);
  return { number: order.number as number, missing, respread, credit, nothingOnHand };
}
