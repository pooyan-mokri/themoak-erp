'use server';

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { TransactionType, Currency, ActionResult, ActionState } from '@/lib/types';
import { additionalCostPerUnit, landedCostPerUnit as computeLandedCostPerUnit, shortShipmentCredit } from '@/lib/landed-cost';
import { auth } from '@/auth';
import { WarehouseUnderAudit, assertNoOpenAudit } from '@/lib/audit-stock-lock';
import { addToConsumable } from '@/lib/fixed-asset-value';
import { kickSiteHook } from '@/lib/site-hook';
import { ACCESS_DENIED_MESSAGE, checkPermission, hasPermission } from '@/lib/access';

// --- Schemas ---

const createSupplierSchema = z.object({
  name: z.string().min(1, 'نام تامین‌کننده الزامی است'),
  phone: z.string().optional(),
  email: z.string().email('ایمیل نامعتبر است').optional().or(z.literal('')),
  address: z.string().optional(),
});

const createPurchaseOrderSchema = z.object({
  supplierId: z.string().min(1, 'تامین‌کننده الزامی است'),
  items: z.array(z.object({
    productId: z.string().min(1, 'محصول الزامی است'),
    quantity: z.number().int('تعداد باید عدد صحیح باشد').min(1, 'تعداد باید بیشتر از ۰ باشد'),
    unitCost: z.number().min(0, 'قیمت خرید نمی‌تواند منفی باشد'),
    currency: z.enum(['TOMAN', 'USD', 'EUR', 'CNY']).default('TOMAN'),
  })).min(1, 'حداقل یک محصول باید انتخاب شود'),
  additionalCosts: z.array(z.object({
    title: z.string().min(1, 'عنوان هزینه الزامی است'),
    amount: z.number().min(0, 'مبلغ باید بیشتر از ۰ باشد'),
    currency: z.enum(['TOMAN', 'USD', 'EUR', 'CNY']),
  })).optional(),
  tags: z.array(z.string()).optional(),
});

/**
 * What a role sees of a purchase order. stock.view: supplier, items, quantities and status. cost.view: unit prices,
 * landed and item costs. finance.view: totals, payments and their transactions. Order and arrival additional-cost
 * amounts are part of the landed cost and of the payable alike, so either permission shows them.
 */
async function purchaseOrderAccess() {
  const [cost, finance] = await Promise.all([hasPermission('cost.view'), hasPermission('finance.view')]);
  return { cost, finance };
}

function withoutHiddenMoney(order: any, see: { cost: boolean; finance: boolean }) {
  const {
    totalAmount,
    totalAmountInToman,
    paymentTransaction,
    paymentAccountId,
    arrivalAccountId,
    payments,
    paidAmountInToman,
    supplierCreditBalance,
    ...rest
  } = order;
  const seeCosts = see.cost || see.finance;
  return {
    ...rest,
    ...(see.finance && { totalAmount, totalAmountInToman, paymentTransaction, paymentAccountId, arrivalAccountId }),
    ...(see.finance && payments !== undefined && { payments, paidAmountInToman }),
    ...(see.finance && supplierCreditBalance !== undefined && { supplierCreditBalance }),
    items: order.items.map((item: any) => {
      const { unitCost, unitCostInToman, totalCostInToman, additionalCost, additionalCostInToman, ...itemRest } = item;
      return see.cost ? item : itemRest;
    }),
    additionalCosts: order.additionalCosts.map((cost: any) => {
      const { amount, amountInToman, ...costRest } = cost;
      return seeCosts ? cost : costRest;
    }),
    arrivalAdditionalCosts: order.arrivalAdditionalCosts.map((cost: any) => {
      const { amount, amountInToman, transaction, transactionId, ...costRest } = cost;
      return {
        ...costRest,
        ...(seeCosts && { amount, amountInToman }),
        ...(see.finance && { transaction, transactionId }),
      };
    }),
  };
}

// --- Actions ---

/** What each supplier owes us back («طلب از تأمین‌کننده»): the sum of its SupplierCredit rows, in Toman. */
async function creditBalances(client: any, supplierIds?: string[]): Promise<Map<string, number>> {
  const rows = await client.supplierCredit.groupBy({
    by: ['supplierId'],
    where: supplierIds ? { supplierId: { in: supplierIds } } : {},
    _sum: { amount: true },
  });
  return new Map(rows.map((row: any) => [row.supplierId, Number(row._sum.amount ?? 0)]));
}

export async function getSuppliers() {
  if (!(await hasPermission(['stock.view', 'finance.view']))) {
    return { success: false, error: ACCESS_DENIED_MESSAGE };
  }
  const canSeeFinance = await hasPermission('finance.view');
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { orders: true }
        }
      }
    });
    // The credit balance is money: only for finance viewers.
    const credits = canSeeFinance ? await creditBalances(prisma) : null;
    const serializedSuppliers = suppliers.map((supplier: any) => ({
      ...supplier,
      phone: supplier.phone ?? undefined,
      email: supplier.email ?? undefined,
      address: supplier.address ?? undefined,
      ...(credits && { creditBalance: credits.get(supplier.id) ?? 0 }),
    }));
    return { success: true, data: serializedSuppliers };
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    return { success: false, error: 'خطا در دریافت لیست تامین‌کنندگان' };
  }
}

export async function createSupplier(prevState: ActionState, formData: FormData): Promise<ActionResult> {
  const denied = await checkPermission(['stock.manage', 'finance.manage']);
  if (denied) return denied;
  try {
    const rawData = {
      name: formData.get('name'),
      phone: formData.get('phone') || undefined,
      email: formData.get('email') || undefined,
      address: formData.get('address') || undefined,
    };

    const validatedData = createSupplierSchema.parse(rawData);

    await prisma.supplier.create({
      data: validatedData,
    });

    revalidatePath('/dashboard/suppliers');
    return { success: true, message: 'تامین‌کننده با موفقیت ایجاد شد' };
  } catch (error: unknown) {
    console.error('Error creating supplier:', error);
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message || 'خطا در اعتبارسنجی' };
    }
    return { success: false, error: 'خطا در ایجاد تامین‌کننده' };
  }
}

export async function getPurchaseOrders() {
  if (!(await hasPermission(['stock.view', 'finance.view']))) {
    return { success: false, error: ACCESS_DENIED_MESSAGE };
  }
  const see = await purchaseOrderAccess();
  try {
    const orders = await prisma.purchaseOrder.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        supplier: true,
        items: {
          include: { product: { select: { id: true, name: true, sku: true } } }
        },
        additionalCosts: true,
        arrivalAdditionalCosts: true,
        paymentTransaction: true
      }
    });

    // Serialize Decimal fields
    const serializedOrders = orders.map((order: any) => ({
      ...order,
      totalAmount: Number(order.totalAmount),
      totalAmountInToman: order.totalAmountInToman ? Number(order.totalAmountInToman) : undefined,
      items: order.items.map((item: any) => ({
        ...item,
        unitCost: Number(item.unitCost),
        unitCostInToman: item.unitCostInToman ? Number(item.unitCostInToman) : undefined,
        exchangeRateSnapshot: item.exchangeRateSnapshot ? Number(item.exchangeRateSnapshot) : undefined,
        totalCostInToman: item.totalCostInToman ? Number(item.totalCostInToman) : undefined,
        additionalCost: item.additionalCost ? Number(item.additionalCost) : undefined,
        additionalCostInToman: item.additionalCostInToman ? Number(item.additionalCostInToman) : undefined,
        receivedDate: item.receivedDate ?? undefined,
        additionalCostCurrency: item.additionalCostCurrency ?? undefined,
      })),
      additionalCosts: order.additionalCosts.map((cost: any) => ({
        ...cost,
        amount: Number(cost.amount),
        amountInToman: cost.amountInToman ? Number(cost.amountInToman) : undefined,
        exchangeRateSnapshot: cost.exchangeRateSnapshot ? Number(cost.exchangeRateSnapshot) : undefined,
      })),
      arrivalAdditionalCosts: order.arrivalAdditionalCosts.map((cost: any) => ({
        ...cost,
        amount: Number(cost.amount),
        amountInToman: cost.amountInToman ? Number(cost.amountInToman) : undefined,
        exchangeRateSnapshot: cost.exchangeRateSnapshot ? Number(cost.exchangeRateSnapshot) : undefined,
        transactionId: cost.transactionId ?? undefined,
      })),
    }));

    return { success: true, data: serializedOrders.map((order: any) => withoutHiddenMoney(order, see)) };
  } catch (error) {
    console.error('Error fetching purchase orders:', error);
    return { success: false, error: 'خطا در دریافت سفارشات خرید' };
  }
}

export async function createPurchaseOrder(data: z.infer<typeof createPurchaseOrderSchema>): Promise<ActionResult> {
  // Sets unit prices and additional (landed) costs.
  const denied = await checkPermission('cost.edit');
  if (denied) return denied;
  try {
    console.log('Received data:', JSON.stringify(data, null, 2));
    const validatedData = createPurchaseOrderSchema.parse(data);
    console.log('Validated data:', JSON.stringify(validatedData, null, 2));

    // Get all unique currencies from items and additional costs
    const allCurrencies = [
      ...validatedData.items.map((item: any) => item.currency),
      ...(validatedData.additionalCosts || []).map((cost: any) => cost.currency)
    ].filter((c, i, arr) => arr.indexOf(c) === i);

    // Get exchange rates for currency conversion
    // Filter out TOMAN as it doesn't need exchange rate
    const currenciesNeedingRates = allCurrencies.filter((c: any) => c !== 'TOMAN');
    
    type ExchangeRate = {
      id: string;
      currency: string;
      date: Date;
      rateToToman: Prisma.Decimal;
    };

    let exchangeRates: ExchangeRate[] = [];
    if (currenciesNeedingRates.length > 0) {
      exchangeRates = await prisma.exchangeRate.findMany({
        where: {
          currency: {
            in: currenciesNeedingRates
          }
        },
        orderBy: { date: 'desc' },
      });

      // Get latest rate for each currency
      const latestRates: Record<string, ExchangeRate> = {};
      exchangeRates.forEach((rate: any) => {
        const currency = rate.currency;
        if (!latestRates[currency] || new Date(rate.date) > new Date(latestRates[currency].date)) {
          latestRates[currency] = rate;
        }
      });
      exchangeRates = Object.values(latestRates);
    }

    const getExchangeRate = (currency: string) => {
      if (currency === 'TOMAN') return 1;
      const rate = exchangeRates.find((r: any) => r.currency === currency);
      // Never silently fall back to 1: that would price a $50 item at 50 Toman
      // and permanently snapshot the error onto the order (there is no edit action).
      if (!rate) {
        throw new Error(`نرخ ارز برای ${currency} یافت نشد. لطفا ابتدا نرخ روز را در بخش حسابداری ثبت کنید.`);
      }
      return Number(rate.rateToToman);
    };

    // Calculate totals for each item and convert to Toman
    let totalAmountInToman = 0;
    const itemsData = validatedData.items.map((item: any) => {
      const exchangeRate = getExchangeRate(item.currency);
      const unitCostInToman = item.unitCost * exchangeRate;
      const itemTotalInToman = item.quantity * unitCostInToman;
      totalAmountInToman += itemTotalInToman;

      return {
        productId: item.productId,
        quantity: item.quantity,
        unitCost: new Prisma.Decimal(item.unitCost),
        currency: item.currency,
        exchangeRateSnapshot: new Prisma.Decimal(exchangeRate),
        unitCostInToman: new Prisma.Decimal(unitCostInToman),
      };
    });

    // Calculate additional costs in Toman
    let additionalCostsInToman = 0;
    const additionalCostsData = (validatedData.additionalCosts || []).map((cost: any) => {
      const exchangeRate = getExchangeRate(cost.currency);
      const amountInToman = cost.amount * exchangeRate;
      additionalCostsInToman += amountInToman;

      return {
        title: cost.title,
        amount: new Prisma.Decimal(cost.amount),
        currency: cost.currency,
        exchangeRateSnapshot: new Prisma.Decimal(exchangeRate),
        amountInToman: new Prisma.Decimal(amountInToman),
      };
    });

    // Calculate total amount (in primary currency - use first item's currency or TOMAN)
    const primaryCurrency = validatedData.items[0]?.currency || 'TOMAN';
    const primaryExchangeRate = getExchangeRate(primaryCurrency);
    const totalAmount = (totalAmountInToman + additionalCostsInToman) / primaryExchangeRate;

    console.log('Creating purchase order with:', {
      supplierId: validatedData.supplierId,
      totalAmount,
      totalAmountInToman: totalAmountInToman + additionalCostsInToman,
      itemsCount: itemsData.length,
      additionalCostsCount: additionalCostsData.length
    });

    await prisma.purchaseOrder.create({
      data: {
        supplierId: validatedData.supplierId,
        totalAmount: new Prisma.Decimal(totalAmount),
        totalAmountInToman: new Prisma.Decimal(totalAmountInToman + additionalCostsInToman),
        status: 'DRAFT',
        tags: validatedData.tags ?? [],
        items: {
          create: itemsData
        },
        ...(additionalCostsData.length > 0 && {
          additionalCosts: {
            create: additionalCostsData
          }
        })
      }
    });

    revalidatePath('/dashboard/suppliers/orders');
    return { success: true, message: 'سفارش خرید با موفقیت ثبت شد' };
  } catch (error: unknown) {
    console.error('Error creating purchase order:', error);
    const errorObj = error as { message?: string; code?: string; meta?: unknown; stack?: string };
    console.error('Error details:', {
      message: errorObj?.message,
      code: errorObj?.code,
      meta: errorObj?.meta,
      stack: errorObj?.stack
    });
    
    if (error instanceof z.ZodError) {
      console.error('Validation errors:', error.issues);
      const firstError = error.issues[0];
      const errorMessage = firstError 
        ? `${firstError.path.join('.')}: ${firstError.message}` 
        : 'خطا در اعتبارسنجی داده‌ها';
      return { success: false, error: errorMessage };
    }
    
    // Handle Prisma errors
    if (errorObj?.code) {
      if (errorObj.code === 'P2002') {
        return { success: false, error: 'این رکورد قبلاً وجود دارد' };
      }
      if (errorObj.code === 'P2003') {
        return { success: false, error: 'رکورد مرتبط یافت نشد' };
      }
    }

    return { success: false, error: errorObj?.message || 'خطا در ثبت سفارش خرید' };
  }
}

export async function getPurchaseOrder(orderId: string) {
  if (!(await hasPermission(['stock.view', 'finance.view']))) {
    return { success: false, error: ACCESS_DENIED_MESSAGE };
  }
  const see = await purchaseOrderAccess();
  try {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: orderId },
      include: {
        supplier: true,
        items: {
          include: { product: { select: { id: true, name: true, sku: true } } }
        },
        additionalCosts: true,
        arrivalAdditionalCosts: {
          include: { transaction: true }
        },
        paymentTransaction: true,
        payments: {
          include: { account: { select: { name: true } } },
          orderBy: { date: 'asc' }
        }
      }
    });

    if (!order) {
      return { success: false, error: 'سفارش یافت نشد' };
    }

    // Convert Decimal fields to numbers for client-side serialization
    type OrderItem = typeof order.items[0] & {
      unitCostInToman?: Prisma.Decimal;
      exchangeRateSnapshot?: Prisma.Decimal;
      totalCostInToman?: Prisma.Decimal;
      additionalCost?: Prisma.Decimal;
      additionalCostInToman?: Prisma.Decimal;
    };

    const serializedOrder = {
      ...order,
      totalAmount: Number(order.totalAmount),
      totalAmountInToman: order.totalAmountInToman ? Number(order.totalAmountInToman) : undefined,
      items: order.items.map((item: any) => ({
        ...item,
        unitCost: Number(item.unitCost),
        unitCostInToman: item.unitCostInToman ? Number(item.unitCostInToman) : undefined,
        exchangeRateSnapshot: item.exchangeRateSnapshot ? Number(item.exchangeRateSnapshot) : undefined,
        totalCostInToman: item.totalCostInToman ? Number(item.totalCostInToman) : undefined,
        additionalCost: item.additionalCost ? Number(item.additionalCost) : undefined,
        additionalCostInToman: item.additionalCostInToman ? Number(item.additionalCostInToman) : undefined,
      })),
      additionalCosts: order.additionalCosts.map((cost: any) => ({
        ...cost,
        amount: Number(cost.amount),
        amountInToman: cost.amountInToman ? Number(cost.amountInToman) : undefined,
        exchangeRateSnapshot: cost.exchangeRateSnapshot ? Number(cost.exchangeRateSnapshot) : undefined,
      })),
      arrivalAdditionalCosts: order.arrivalAdditionalCosts.map((cost: any) => ({
        ...cost,
        amount: Number(cost.amount),
        amountInToman: cost.amountInToman ? Number(cost.amountInToman) : undefined,
        exchangeRateSnapshot: cost.exchangeRateSnapshot ? Number(cost.exchangeRateSnapshot) : undefined,
        transactionId: cost.transactionId ?? undefined,
      })),
      payments: (order.payments ?? []).map((p: any) => ({
        id: p.id,
        amount: Number(p.amount),
        accountId: p.accountId ?? undefined,
        // A payment with no account was paid from the supplier's credit.
        accountName: p.accountId ? (p.account?.name ?? '') : 'طلب از تأمین‌کننده',
        fromCredit: !p.accountId,
        description: p.description ?? undefined,
        date: p.date,
      })),
      paidAmountInToman: (order.payments ?? []).reduce((sum: number, p: any) => sum + Number(p.amount), 0),
      supplierCreditBalance: (await creditBalances(prisma, [order.supplierId])).get(order.supplierId) ?? 0,
    };

    return { success: true, data: withoutHiddenMoney(serializedOrder, see) };
  } catch (error) {
    console.error('Error fetching purchase order:', error);
    return { success: false, error: 'خطا در دریافت سفارش خرید' };
  }
}

// A refusal found inside a transaction: thrown so everything rolls back, then shown to the user as it is.
class ReceiveRefusal extends Error {}

/** Goods come in once the order has arrived, and until every line is received. */
const RECEIVABLE_STATUSES = ['ARRIVED', 'PARTIALLY_RECEIVED'];

export async function receivePurchaseOrderItems(
  orderId: string,
  warehouseId: string,
  receivedItems: Array<{ itemId: string; receivedQuantity: number }>
): Promise<ActionResult> {
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
  // One quantity per line: the same line sent twice in one call adds up.
  const quantities = new Map<string, number>();
  for (const { itemId, receivedQuantity } of receivedItems) {
    if (!Number.isInteger(receivedQuantity) || receivedQuantity <= 0) {
      return { success: false, error: 'تعداد دریافتی هر قلم باید عدد صحیح و بزرگ‌تر از صفر باشد.' };
    }
    quantities.set(itemId, (quantities.get(itemId) ?? 0) + receivedQuantity);
  }
  if (quantities.size === 0) return { success: false, error: 'لطفا حداقل یک آیتم را برای دریافت انتخاب کنید' };
  try {
    await prisma.$transaction(async (tx: any) => {
      // Hold the order: a second receipt (a double click, another tab) waits, then reads what this one received.
      await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${orderId} FOR UPDATE`;

      // 1. Get Order with products and all costs
      const order = await tx.purchaseOrder.findUnique({
        where: { id: orderId },
        include: { 
          items: {
            include: {
              product: true
            }
          },
          additionalCosts: true,
          arrivalAdditionalCosts: true
        }
      });

      if (!order) throw new ReceiveRefusal('سفارش یافت نشد');
      if (!RECEIVABLE_STATUSES.includes(order.status)) {
        throw new ReceiveRefusal('این سفارش در وضعیت دریافت کالا نیست؛ کالا پس از ثبت رسیدن به مقصد دریافت می‌شود.');
      }

      // The receive dialog offers live physical warehouses only; a stale page must not put goods elsewhere.
      const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId } });
      if (!warehouse || warehouse.isArchived || warehouse.isVirtual) {
        throw new ReceiveRefusal('انبار دریافت باید یک انبار فیزیکی و فعال باشد.');
      }
      await assertNoOpenAudit(tx, [warehouseId]);

      // Get exchange rates
      const exchangeRates = await tx.exchangeRate.findMany({
        orderBy: { date: 'desc' },
        distinct: ['currency'],
      });

      const getExchangeRate = (currency: string) => {
        if (currency === 'TOMAN') return 1;
        const rate = exchangeRates.find((r: any) => r.currency === currency);
        if (!rate) {
          throw new ReceiveRefusal(`نرخ ارز برای ${currency} یافت نشد. لطفا ابتدا نرخ روز را در بخش حسابداری ثبت کنید.`);
        }
        return Number(rate.rateToToman);
      };

      // Additional costs (order-level + arrival) are allocated PRO RATA ON VALUE
      // by the shared helper in @/lib/landed-cost, which the purchase-order UI
      // uses too so the displayed and stored landed cost can never diverge.
      // 2. Process each received item
      for (const [itemId, receivedQuantity] of quantities) {
        const receivedItem = { itemId, receivedQuantity };
        const orderItem = order.items.find((item: any) => item.id === receivedItem.itemId);
        if (!orderItem) throw new ReceiveRefusal('قلم دریافتی جزو این سفارش نیست.');

        const newReceivedQuantity = (orderItem.receivedQuantity || 0) + receivedItem.receivedQuantity;
        
        if (newReceivedQuantity > orderItem.quantity) {
          throw new ReceiveRefusal(`تعداد دریافت شده برای ${orderItem.product.name} بیشتر از تعداد سفارش داده شده است`);
        }

        // Landed cost per unit = own unit cost + value-weighted share of the
        // order-level and arrival additional costs (all in Toman).
        const landedCostPerUnit = computeLandedCostPerUnit(orderItem, order, getExchangeRate);
        
        // Calculate total cost for this item (for all received quantities)
        const previousReceivedQty = orderItem.receivedQuantity || 0;
        const previousTotalCost = orderItem.totalCostInToman ? Number(orderItem.totalCostInToman) : 0;
        const newQuantityCost = receivedItem.receivedQuantity * landedCostPerUnit;
        const newTotalCostInToman = previousTotalCost + newQuantityCost;

        // Update order item
        await tx.purchaseOrderItem.update({
          where: { id: receivedItem.itemId },
          data: {
            receivedQuantity: newReceivedQuantity,
            receivedDate: new Date(),
            totalCostInToman: newTotalCostInToman,
          }
        });

        // Process based on product type. Read afresh: an earlier line of this receipt may be the same product.
        const product = await tx.product.findUniqueOrThrow({ where: { id: orderItem.productId } });
        const productType = product.productType;
        const purchaseDate = new Date();
        const purchasePrice = landedCostPerUnit; // Use landed cost per unit, not average

        if (productType === 'SALEABLE' || productType === 'OTHER') {
          // Roll the landed cost into the product's cost of record using a
          // WEIGHTED AVERAGE over the stock already on hand. Without this the
          // freight/customs share computed above is discarded and every
          // valuation, COGS and margin figure keeps using a stale cost.
          const stockBefore = await tx.inventory.aggregate({
            where: { productId: orderItem.productId },
            _sum: { quantity: true },
          });
          const qtyBefore = Math.max(0, Number(stockBefore._sum.quantity ?? 0));
          const costBefore = Number(product.costPrice ?? 0);
          const receivedQty = receivedItem.receivedQuantity;

          // Fall back to the pure landed cost when there is nothing meaningful
          // to average against (no prior stock, or no prior cost recorded).
          const newCostPrice =
            qtyBefore > 0 && costBefore > 0
              ? (qtyBefore * costBefore + receivedQty * landedCostPerUnit) / (qtyBefore + receivedQty)
              : landedCostPerUnit;

          await tx.product.update({
            where: { id: orderItem.productId },
            data: { costPrice: new Prisma.Decimal(newCostPrice) },
          });

          // Add to Inventory
          await tx.inventory.upsert({
            where: {
              productId_warehouseId: {
                productId: orderItem.productId,
                warehouseId: warehouseId
              }
            },
            update: {
              quantity: { increment: receivedItem.receivedQuantity }
            },
            create: {
              productId: orderItem.productId,
              warehouseId: warehouseId,
              quantity: receivedItem.receivedQuantity
            }
          });

          // Record the movement so the receipt is auditable. The note stays free of the landed cost: stock
          // roles read movement notes, and the cost is kept on the order item.
          await tx.inventoryMovement.create({
            data: {
              productId: orderItem.productId,
              toWarehouseId: warehouseId,
              quantity: receivedItem.receivedQuantity,
              type: 'PURCHASE',
              referenceId: orderId,
              note: `دریافت سفارش خرید #${order.number}`,
            },
          });
        } else if (productType === 'CONSUMABLE') {
          // Add to FixedAsset for consumable items, valued at quantity × unit cost (src/lib/fixed-asset-value.ts)
          const existingAsset = await tx.fixedAsset.findUnique({
            where: { productId: orderItem.productId }
          });

          if (existingAsset) {
            // A later receipt adds to the asset at its own cost; the earlier units keep theirs.
            const added = addToConsumable(existingAsset, receivedItem.receivedQuantity, purchasePrice);
            await tx.fixedAsset.update({
              where: { id: existingAsset.id },
              data: {
                quantity: added.quantity,
                purchasePrice: added.unitCost,
                currentValue: added.value,
              }
            });
          } else {
            await tx.fixedAsset.create({
              data: {
                name: product.name,
                productId: orderItem.productId,
                assetType: 'CONSUMABLE',
                purchaseDate: purchaseDate,
                purchasePrice: purchasePrice,
                salvageValue: 0,
                usefulLife: 1,
                quantity: receivedItem.receivedQuantity,
                depreciationMethod: 'STRAIGHT_LINE',
                currentValue: purchasePrice * receivedItem.receivedQuantity
              }
            });
          }
        } else if (productType === 'FIXED_ASSET') {
          // Create a new FixedAsset entry for each fixed asset. productId is unique on FixedAsset, so only the
          // product's first asset ever carries it: a later receipt of the same product must not repeat it.
          const linked = await tx.fixedAsset.findUnique({ where: { productId: orderItem.productId }, select: { id: true } });
          for (let i = 0; i < receivedItem.receivedQuantity; i++) {
            await tx.fixedAsset.create({
              data: {
                name: `${product.name}${receivedItem.receivedQuantity > 1 ? ` #${i + 1}` : ''}`,
                productId: i === 0 && !linked ? orderItem.productId : undefined,
                assetType: 'FIXED',
                purchaseDate: purchaseDate,
                purchasePrice: purchasePrice,
                salvageValue: 0,
                usefulLife: 5,
                quantity: 1,
                depreciationMethod: 'STRAIGHT_LINE',
                currentValue: purchasePrice
              }
            });
          }
        }
      }

      // 3. Update Order Status: RECEIVED only once every line of the order is in, not just the lines sent now.
      const lines = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: orderId },
        select: { quantity: true, receivedQuantity: true },
      });
      const allItemsReceived = lines.every((line: any) => line.receivedQuantity >= line.quantity);
      const newStatus = allItemsReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
      await tx.purchaseOrder.update({
        where: { id: orderId },
        data: { status: newStatus }
      });
    });
    kickSiteHook();

    try {
      revalidatePath('/dashboard/suppliers/orders');
      revalidatePath(`/dashboard/suppliers/orders/${orderId}`);
      revalidatePath('/dashboard/inventory');
      revalidatePath('/dashboard/inventory/assets');
    } catch (error) {
      // Ignore revalidatePath error outside of Next.js context
    }
    return { success: true, message: 'کالاها با موفقیت دریافت و به موجودی اضافه شدند' };
  } catch (error: unknown) {
    if (error instanceof ReceiveRefusal || error instanceof WarehouseUnderAudit) return { success: false, error: error.message };
    console.error('Error receiving purchase order items:', error);
    return { success: false, error: 'خطا در دریافت کالاها' };
  }
}

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
 */
export async function closePurchaseOrderShort(orderId: string, expectedCredit?: number): Promise<ActionResult> {
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
  const session = await auth();
  try {
    const result = await prisma.$transaction(async (tx: any) => {
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
      if (!order) throw new ReceiveRefusal('سفارش یافت نشد');
      if (order.status !== 'PARTIALLY_RECEIVED') {
        throw new ReceiveRefusal('فقط سفارشی که بخشی از آن دریافت شده، با کسری بسته می‌شود.');
      }

      const exchangeRates = await tx.exchangeRate.findMany({ orderBy: { date: 'desc' }, distinct: ['currency'] });
      const getExchangeRate = (currency: string) => {
        if (currency === 'TOMAN') return 1;
        const rate = exchangeRates.find((r: any) => r.currency === currency);
        if (!rate) {
          throw new ReceiveRefusal(`نرخ ارز برای ${currency} یافت نشد. لطفا ابتدا نرخ روز را در بخش حسابداری ثبت کنید.`);
        }
        return Number(rate.rateToToman);
      };

      const paid = order.payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
      const credit = shortShipmentCredit(order, paid, getExchangeRate);
      if (expectedCredit !== undefined && Math.abs(expectedCredit - credit) >= 1) {
        throw new ReceiveRefusal('پرداخت‌ها یا دریافت‌های این سفارش از وقتی صفحه باز شد تغییر کرده است؛ صفحه را تازه کنید و دوباره ببندید.');
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
            userId: session?.user?.id ?? null,
            clientRequestId: `po-short:${orderId}`,
          },
        });
      }
      const missing = order.items.reduce((sum: number, item: any) => sum + Math.max(0, item.quantity - item.receivedQuantity), 0);
      return { missing, respread, credit, nothingOnHand };
    });

    try {
      revalidatePath('/dashboard/suppliers/orders');
      revalidatePath(`/dashboard/suppliers/orders/${orderId}`);
      revalidatePath('/dashboard/inventory');
    } catch (error) {
      // Ignore revalidatePath error outside of Next.js context
    }
    const toman = (amount: number) => `${Math.round(amount).toLocaleString('fa-IR')} تومان`;
    const parts = [
      result.respread > 0
        ? `دریافت سفارش با کسری ${result.missing.toLocaleString('fa-IR')} عدد بسته شد و ${toman(result.respread)} از هزینه‌های اضافی روی کالاهای دریافت‌شده سرشکن شد.`
        : `دریافت سفارش با کسری ${result.missing.toLocaleString('fa-IR')} عدد بسته شد.`,
    ];
    if (result.credit > 0) parts.push(`${toman(result.credit)} پرداخت‌شده بابت کالای نرسیده به طلب از تأمین‌کننده اضافه شد.`);
    if (result.nothingOnHand.length > 0) {
      parts.push(`از ${result.nothingOnHand.map((name: string) => `«${name}»`).join('، ')} موجودی‌ای نمانده بود؛ سهم هزینه‌های اضافی آن به بهای تمام‌شده اضافه نشد.`);
    }
    return { success: true, message: parts.join(' ') };
  } catch (error: unknown) {
    if (error instanceof ReceiveRefusal) return { success: false, error: error.message };
    console.error('Error closing purchase order short:', error);
    return { success: false, error: 'خطا در بستن سفارش با کسری' };
  }
}

// Keep the old function for backward compatibility, but mark as deprecated. It used to put the whole order into
// stock with no movement, no received quantities and no landed cost, even after part of it was received; it now
// receives every line's remaining quantity through receivePurchaseOrderItems.
export async function receivePurchaseOrder(orderId: string, warehouseId: string): Promise<ActionResult> {
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
  const items = await prisma.purchaseOrderItem.findMany({
    where: { purchaseOrderId: orderId },
    select: { id: true, quantity: true, receivedQuantity: true },
  });
  if (items.length === 0) return { success: false, error: 'سفارش یافت نشد' };
  const remaining = items
    .filter((item: any) => item.quantity > item.receivedQuantity)
    .map((item: any) => ({ itemId: item.id, receivedQuantity: item.quantity - item.receivedQuantity }));
  if (remaining.length === 0) return { success: false, error: 'این سفارش قبلاً دریافت شده است' };
  const result = await receivePurchaseOrderItems(orderId, warehouseId, remaining);
  return result.success ? { success: true, message: 'سفارش با موفقیت دریافت و به موجودی اضافه شد' } : result;
}
