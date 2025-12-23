'use server';

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { TransactionType, Currency } from '@/lib/types';

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
});

// --- Actions ---

export async function getSuppliers() {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { orders: true }
        }
      }
    });
    return { success: true, data: suppliers };
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    return { success: false, error: 'خطا در دریافت لیست تامین‌کنندگان' };
  }
}

export async function createSupplier(prevState: any, formData: FormData) {
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
  } catch (error) {
    console.error('Error creating supplier:', error);
    if (error instanceof z.ZodError) {
      return { success: false, error: (error as any).errors[0].message };
    }
    return { success: false, error: 'خطا در ایجاد تامین‌کننده' };
  }
}

export async function getPurchaseOrders() {
  try {
    const orders = await prisma.purchaseOrder.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        supplier: true,
        items: {
          include: { product: true }
        },
        additionalCosts: true,
        arrivalAdditionalCosts: true,
        paymentTransaction: true
      }
    });
    return { success: true, data: orders };
  } catch (error) {
    console.error('Error fetching purchase orders:', error);
    return { success: false, error: 'خطا در دریافت سفارشات خرید' };
  }
}

export async function createPurchaseOrder(data: z.infer<typeof createPurchaseOrderSchema>) {
  try {
    console.log('Received data:', JSON.stringify(data, null, 2));
    const validatedData = createPurchaseOrderSchema.parse(data);
    console.log('Validated data:', JSON.stringify(validatedData, null, 2));

    // Get all unique currencies from items and additional costs
    const allCurrencies = [
      ...validatedData.items.map(item => item.currency),
      ...(validatedData.additionalCosts || []).map(cost => cost.currency)
    ].filter((c, i, arr) => arr.indexOf(c) === i);

    // Get exchange rates for currency conversion
    // Filter out TOMAN as it doesn't need exchange rate
    const currenciesNeedingRates = allCurrencies.filter(c => c !== 'TOMAN');
    
    let exchangeRates: any[] = [];
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
      const latestRates: Record<string, any> = {};
      exchangeRates.forEach(rate => {
        const currency = rate.currency;
        if (!latestRates[currency] || new Date(rate.date) > new Date(latestRates[currency].date)) {
          latestRates[currency] = rate;
        }
      });
      exchangeRates = Object.values(latestRates);
    }

    const getExchangeRate = (currency: string) => {
      if (currency === 'TOMAN') return 1;
      const rate = exchangeRates.find(r => r.currency === currency);
      if (!rate) {
        console.warn(`Exchange rate not found for ${currency}, using 1`);
        return 1;
      }
      return Number(rate.rateToToman);
    };

    // Calculate totals for each item and convert to Toman
    let totalAmountInToman = 0;
    const itemsData = validatedData.items.map(item => {
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
    const additionalCostsData = (validatedData.additionalCosts || []).map(cost => {
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
  } catch (error: any) {
    console.error('Error creating purchase order:', error);
    console.error('Error details:', {
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
      stack: error?.stack
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
    if (error?.code) {
      if (error.code === 'P2002') {
        return { success: false, error: 'این رکورد قبلاً وجود دارد' };
      }
      if (error.code === 'P2003') {
        return { success: false, error: 'رکورد مرتبط یافت نشد' };
      }
    }
    
    return { success: false, error: error?.message || 'خطا در ثبت سفارش خرید' };
  }
}

export async function getPurchaseOrder(orderId: string) {
  try {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: orderId },
      include: {
        supplier: true,
        items: {
          include: { product: true }
        },
        additionalCosts: true,
        arrivalAdditionalCosts: {
          include: { transaction: true }
        },
        paymentTransaction: true
      }
    });

    if (!order) {
      return { success: false, error: 'سفارش یافت نشد' };
    }

    // Convert Decimal fields to numbers for client-side serialization
    const serializedOrder = {
      ...order,
      totalAmount: Number(order.totalAmount),
      totalAmountInToman: order.totalAmountInToman ? Number(order.totalAmountInToman) : null,
      items: order.items.map((item: any) => ({
        ...item,
        unitCost: Number(item.unitCost),
        unitCostInToman: item.unitCostInToman ? Number(item.unitCostInToman) : null,
        exchangeRateSnapshot: item.exchangeRateSnapshot ? Number(item.exchangeRateSnapshot) : null,
        totalCostInToman: item.totalCostInToman ? Number(item.totalCostInToman) : null,
        additionalCost: item.additionalCost ? Number(item.additionalCost) : null,
        additionalCostInToman: item.additionalCostInToman ? Number(item.additionalCostInToman) : null,
      })),
      additionalCosts: order.additionalCosts.map((cost: any) => ({
        ...cost,
        amount: Number(cost.amount),
        amountInToman: cost.amountInToman ? Number(cost.amountInToman) : null,
        exchangeRateSnapshot: cost.exchangeRateSnapshot ? Number(cost.exchangeRateSnapshot) : null,
      })),
      arrivalAdditionalCosts: order.arrivalAdditionalCosts.map((cost: any) => ({
        ...cost,
        amount: Number(cost.amount),
        amountInToman: cost.amountInToman ? Number(cost.amountInToman) : null,
        exchangeRateSnapshot: cost.exchangeRateSnapshot ? Number(cost.exchangeRateSnapshot) : null,
      })),
    };

    return { success: true, data: serializedOrder };
  } catch (error) {
    console.error('Error fetching purchase order:', error);
    return { success: false, error: 'خطا در دریافت سفارش خرید' };
  }
}

export async function receivePurchaseOrderItems(
  orderId: string,
  warehouseId: string,
  receivedItems: Array<{ itemId: string; receivedQuantity: number }>
) {
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
        return rate ? Number(rate.rateToToman) : 1;
      };

      // Calculate total additional costs (from order and arrival) in Toman
      let totalAdditionalCostsInToman = 0;
      
      // Add order additional costs
      if (order.additionalCosts && order.additionalCosts.length > 0) {
        order.additionalCosts.forEach((cost: any) => {
          totalAdditionalCostsInToman += Number(cost.amountInToman || 0);
        });
      }
      
      // Add arrival additional costs
      if (order.arrivalAdditionalCosts && order.arrivalAdditionalCosts.length > 0) {
        order.arrivalAdditionalCosts.forEach((cost: any) => {
          totalAdditionalCostsInToman += Number(cost.amountInToman || 0);
        });
      }

      // Calculate total quantity of all items in the order
      const totalOrderQuantity = order.items.reduce((sum: number, item: any) => sum + item.quantity, 0);
      
      // Calculate additional cost per unit (distributed across all items)
      const additionalCostPerUnit = totalOrderQuantity > 0 ? totalAdditionalCostsInToman / totalOrderQuantity : 0;

      let allItemsReceived = true;

      // 2. Process each received item
      for (const receivedItem of receivedItems) {
        const orderItem = order.items.find((item: any) => item.id === receivedItem.itemId);
        if (!orderItem) continue;

        const newReceivedQuantity = (orderItem.receivedQuantity || 0) + receivedItem.receivedQuantity;
        
        if (newReceivedQuantity > orderItem.quantity) {
          throw new Error(`تعداد دریافت شده برای ${orderItem.product.name} بیشتر از تعداد سفارش داده شده است`);
        }

        // Calculate unit cost in Toman
        const unitCostInToman = orderItem.unitCostInToman || (Number(orderItem.unitCost) * getExchangeRate(orderItem.currency));
        
        // Calculate landed cost per unit: unit cost + additional cost per unit
        const landedCostPerUnit = unitCostInToman + additionalCostPerUnit;
        
        // Calculate total cost for this item (for all received quantities)
        const previousReceivedQty = orderItem.receivedQuantity || 0;
        const previousTotalCost = (orderItem.totalCostInToman || 0);
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
                productId: i === 0 ? orderItem.productId : null,
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

    try {
      revalidatePath('/dashboard/suppliers/orders');
      revalidatePath(`/dashboard/suppliers/orders/${orderId}`);
      revalidatePath('/dashboard/inventory');
      revalidatePath('/dashboard/inventory/assets');
    } catch (error) {
      // Ignore revalidatePath error outside of Next.js context
    }
    return { success: true, message: 'کالاها با موفقیت دریافت و به موجودی اضافه شدند' };
  } catch (error: any) {
    console.error('Error receiving purchase order items:', error);
    return { success: false, error: error.message || 'خطا در دریافت کالاها' };
  }
}

// Keep the old function for backward compatibility, but mark as deprecated
export async function receivePurchaseOrder(orderId: string, warehouseId: string) {
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
                productId: i === 0 ? item.productId : null, // Only first one gets productId
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

    try {
      revalidatePath('/dashboard/suppliers/orders');
      revalidatePath('/dashboard/inventory');
      revalidatePath('/dashboard/inventory/assets');
    } catch (error) {
      // Ignore revalidatePath error outside of Next.js context
    }
    return { success: true, message: 'سفارش با موفقیت دریافت و به موجودی اضافه شد' };
  } catch (error: any) {
    console.error('Error receiving purchase order:', error);
    return { success: false, error: error.message || 'خطا در دریافت سفارش' };
  }
}
