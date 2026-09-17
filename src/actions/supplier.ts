'use server';

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { TransactionType, Currency, ActionResult, ActionState } from '@/lib/types';
import { landedCostPerUnit as computeLandedCostPerUnit } from '@/lib/landed-cost';
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
    quantity: z.number().min(1, 'تعداد باید بیشتر از ۰ باشد'),
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
  const { totalAmount, totalAmountInToman, paymentTransaction, paymentAccountId, arrivalAccountId, payments, paidAmountInToman, ...rest } =
    order;
  const seeCosts = see.cost || see.finance;
  return {
    ...rest,
    ...(see.finance && { totalAmount, totalAmountInToman, paymentTransaction, paymentAccountId, arrivalAccountId }),
    ...(see.finance && payments !== undefined && { payments, paidAmountInToman }),
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

export async function getSuppliers() {
  if (!(await hasPermission(['stock.view', 'finance.view']))) {
    return { success: false, error: ACCESS_DENIED_MESSAGE };
  }
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { orders: true }
        }
      }
    });
    const serializedSuppliers = suppliers.map((supplier: any) => ({
      ...supplier,
      phone: supplier.phone ?? undefined,
      email: supplier.email ?? undefined,
      address: supplier.address ?? undefined,
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
        accountId: p.accountId,
        accountName: p.account?.name ?? '',
        description: p.description ?? undefined,
        date: p.date,
      })),
      paidAmountInToman: (order.payments ?? []).reduce((sum: number, p: any) => sum + Number(p.amount), 0),
    };

    return { success: true, data: withoutHiddenMoney(serializedOrder, see) };
  } catch (error) {
    console.error('Error fetching purchase order:', error);
    return { success: false, error: 'خطا در دریافت سفارش خرید' };
  }
}

export async function receivePurchaseOrderItems(
  orderId: string,
  warehouseId: string,
  receivedItems: Array<{ itemId: string; receivedQuantity: number }>
): Promise<ActionResult> {
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
  try {
    await prisma.$transaction(async (tx: any) => {
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

      if (!order) throw new Error('سفارش یافت نشد');

      // Get exchange rates
      const exchangeRates = await tx.exchangeRate.findMany({
        orderBy: { date: 'desc' },
        distinct: ['currency'],
      });

      const getExchangeRate = (currency: string) => {
        if (currency === 'TOMAN') return 1;
        const rate = exchangeRates.find((r: any) => r.currency === currency);
        if (!rate) {
          throw new Error(`نرخ ارز برای ${currency} یافت نشد. لطفا ابتدا نرخ روز را در بخش حسابداری ثبت کنید.`);
        }
        return Number(rate.rateToToman);
      };

      // Additional costs (order-level + arrival) are allocated PRO RATA ON VALUE
      // by the shared helper in @/lib/landed-cost, which the purchase-order UI
      // uses too so the displayed and stored landed cost can never diverge.
      let allItemsReceived = true;

      // 2. Process each received item
      for (const receivedItem of receivedItems) {
        const orderItem = order.items.find((item: any) => item.id === receivedItem.itemId);
        if (!orderItem) continue;

        const newReceivedQuantity = (orderItem.receivedQuantity || 0) + receivedItem.receivedQuantity;
        
        if (newReceivedQuantity > orderItem.quantity) {
          throw new Error(`تعداد دریافت شده برای ${orderItem.product.name} بیشتر از تعداد سفارش داده شده است`);
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

        // Process based on product type
        const product = orderItem.product;
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
          // Add to FixedAsset for consumable items
          const existingAsset = await tx.fixedAsset.findUnique({
            where: { productId: orderItem.productId }
          });

          if (existingAsset) {
            await tx.fixedAsset.update({
              where: { id: existingAsset.id },
              data: {
                quantity: { increment: receivedItem.receivedQuantity },
                purchasePrice: purchasePrice,
                purchaseDate: purchaseDate
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
                currentValue: purchasePrice
              }
            });
          }
        } else if (productType === 'FIXED_ASSET') {
          // Create a new FixedAsset entry for each fixed asset
          for (let i = 0; i < receivedItem.receivedQuantity; i++) {
            await tx.fixedAsset.create({
              data: {
                name: `${product.name}${receivedItem.receivedQuantity > 1 ? ` #${i + 1}` : ''}`,
                productId: i === 0 ? orderItem.productId : undefined,
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

        // Check if all items are fully received
        if (newReceivedQuantity < orderItem.quantity) {
          allItemsReceived = false;
        }
      }

      // 3. Update Order Status
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
    console.error('Error receiving purchase order items:', error);
    const message = error instanceof Error ? error.message : 'خطا در دریافت کالاها';
    return { success: false, error: message };
  }
}

// Keep the old function for backward compatibility, but mark as deprecated
export async function receivePurchaseOrder(orderId: string, warehouseId: string): Promise<ActionResult> {
  const denied = await checkPermission('stock.manage');
  if (denied) return denied;
  try {
    await prisma.$transaction(async (tx: any) => {
      // 1. Get Order with products
      const order = await tx.purchaseOrder.findUnique({
        where: { id: orderId },
        include: { 
          items: {
            include: {
              product: true
            }
          }
        }
      });

      if (!order) throw new Error('سفارش یافت نشد');
      if (order.status === 'RECEIVED') throw new Error('این سفارش قبلاً دریافت شده است');

      // 2. Process each item based on productType
      for (const item of order.items) {
        const product = item.product;
        const productType = product.productType;
        const purchaseDate = new Date();
        const purchasePrice = Number(item.unitCost);

        if (productType === 'SALEABLE' || productType === 'OTHER') {
          // Add to Inventory for sellable products
        await tx.inventory.upsert({
          where: {
            productId_warehouseId: {
              productId: item.productId,
              warehouseId: warehouseId
            }
          },
          update: {
            quantity: { increment: item.quantity }
          },
          create: {
            productId: item.productId,
            warehouseId: warehouseId,
            quantity: item.quantity
          }
        });
        } else if (productType === 'CONSUMABLE') {
          // Add to FixedAsset for consumable items
          // If a FixedAsset with this productId exists, increment quantity
          // Otherwise, create a new one
          const existingAsset = await tx.fixedAsset.findUnique({
            where: { productId: item.productId }
          });

          if (existingAsset) {
            // Update quantity for existing consumable asset
            await tx.fixedAsset.update({
              where: { id: existingAsset.id },
              data: {
                quantity: { increment: item.quantity },
                // Update purchase price to latest
                purchasePrice: purchasePrice,
                purchaseDate: purchaseDate
              }
            });
          } else {
            // Create new consumable asset
            await tx.fixedAsset.create({
              data: {
                name: product.name,
                productId: item.productId,
                assetType: 'CONSUMABLE',
                purchaseDate: purchaseDate,
                purchasePrice: purchasePrice,
                salvageValue: 0,
                usefulLife: 1, // Default 1 year for consumables
                quantity: item.quantity,
                depreciationMethod: 'STRAIGHT_LINE',
                currentValue: purchasePrice
              }
            });
          }
        } else if (productType === 'FIXED_ASSET') {
          // Create a new FixedAsset entry for each fixed asset purchase
          // Each fixed asset is tracked individually, so create one per quantity
          // Only the first one gets productId (due to unique constraint)
          for (let i = 0; i < item.quantity; i++) {
            await tx.fixedAsset.create({
              data: {
                name: `${product.name}${item.quantity > 1 ? ` #${i + 1}` : ''}`,
                productId: i === 0 ? item.productId : undefined, // Only first one gets productId
                assetType: 'FIXED',
                purchaseDate: purchaseDate,
                purchasePrice: purchasePrice,
                salvageValue: 0, // Can be updated later if needed
                usefulLife: 5, // Default 5 years, can be updated later
                quantity: 1, // Fixed assets are typically 1 per entry
                depreciationMethod: 'STRAIGHT_LINE',
                currentValue: purchasePrice
              }
            });
          }
        }
      }

      // 3. Update Order Status
      await tx.purchaseOrder.update({
        where: { id: orderId },
        data: { status: 'RECEIVED' }
      });
      
      // 4. Create Financial Transaction (Expense) - Simplified
      // Assuming payment is made upon receipt or tracked separately. 
      // We'll skip auto-transaction creation for now to keep it simple, 
      // or we could add an "Accounts Payable" entry if we had that module.
    });
    kickSiteHook();

    try {
      revalidatePath('/dashboard/suppliers/orders');
      revalidatePath('/dashboard/inventory');
      revalidatePath('/dashboard/inventory/assets');
    } catch (error) {
      // Ignore revalidatePath error outside of Next.js context
    }
    return { success: true, message: 'سفارش با موفقیت دریافت و به موجودی اضافه شد' };
  } catch (error: unknown) {
    console.error('Error receiving purchase order:', error);
    const message = error instanceof Error ? error.message : 'خطا در دریافت سفارش';
    return { success: false, error: message };
  }
}
