'use server';

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { TransactionType } from '@prisma/client';

const OrderExchangeSchema = z.object({
  orderId: z.string().min(1, 'شناسه سفارش الزامی است'),
  originalItemId: z.string().min(1, 'شناسه آیتم اصلی الزامی است'),
  exchangeProductId: z.string().min(1, 'کالای تعویضی الزامی است'),
  quantity: z.coerce.number().int().positive('تعداد باید بیشتر از صفر باشد'),
  accountId: z.string().min(1, 'حساب الزامی است'),
});

export async function exchangeOrderItem(prevState: any, formData: FormData) {
  const validatedFields = OrderExchangeSchema.safeParse({
    orderId: formData.get('orderId'),
    originalItemId: formData.get('originalItemId'),
    exchangeProductId: formData.get('exchangeProductId'),
    quantity: formData.get('quantity'),
    accountId: formData.get('accountId'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
      success: false,
    };
  }

  const { orderId, originalItemId, exchangeProductId, quantity, accountId } = validatedFields.data;

  try {
    await prisma.$transaction(async (tx: any) => {
      // 1. Get order and original item
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: { product: true },
          },
        },
      });

      if (!order) {
        throw new Error('سفارش یافت نشد.');
      }

      const originalItem = order.items.find((item: any) => item.id === originalItemId);
      if (!originalItem) {
        throw new Error('آیتم اصلی یافت نشد.');
      }

      if (quantity > originalItem.quantity) {
        throw new Error(`تعداد تعویض شده نمی‌تواند بیشتر از تعداد خریداری شده باشد (${originalItem.quantity}).`);
      }

      // 2. Get exchange product
      const exchangeProduct = await tx.product.findUnique({
        where: { id: exchangeProductId },
      });

      if (!exchangeProduct) {
        throw new Error('کالای تعویضی یافت نشد.');
      }

      // 3. Check inventory for exchange product
      const exchangeInventory = await tx.inventory.findFirst({
        where: {
          productId: exchangeProductId,
          quantity: { gte: quantity },
        },
      });

      if (!exchangeInventory) {
        throw new Error(`موجودی کافی برای کالای تعویضی "${exchangeProduct.name}" وجود ندارد.`);
      }

      // 4. Calculate price difference
      const originalPrice = Number(originalItem.price) * quantity;
      const exchangePrice = Number(exchangeProduct.sellPrice) * quantity;
      const priceDifference = exchangePrice - originalPrice;

      // 5. Get account
      const account = await tx.account.findUnique({
        where: { id: accountId },
      });

      if (!account) {
        throw new Error('حساب یافت نشد.');
      }

      // 6. Create transaction if there's a price difference
      let transactionId = null;
      if (priceDifference !== 0) {
        const transactionType = priceDifference > 0 ? TransactionType.INCOME : TransactionType.EXPENSE;
        const transaction = await tx.transaction.create({
          data: {
            type: transactionType,
            amount: Math.abs(priceDifference),
            currency: 'TOMAN',
            rateSnapshot: 1,
            amountInToman: Math.abs(priceDifference),
            accountId: accountId,
            description: `تعویض کالا - سفارش #${order.number} - ${originalItem.product.name} → ${exchangeProduct.name}`,
            category: 'Exchange',
            date: new Date(),
          },
        });
        transactionId = transaction.id;

        // Update account balance
        if (priceDifference > 0) {
          // Customer owes us
          await tx.account.update({
            where: { id: accountId },
            data: {
              balance: {
                increment: priceDifference,
              },
            },
          });
        } else {
          // We owe customer
          await tx.account.update({
            where: { id: accountId },
            data: {
              balance: {
                decrement: Math.abs(priceDifference),
              },
            },
          });
        }
      }

      // 7. Create exchange item in order (for record keeping)
      const exchangeItem = await tx.orderItem.create({
        data: {
          orderId,
          productId: exchangeProductId,
          quantity,
          price: new Prisma.Decimal(exchangeProduct.sellPrice),
        },
      });

      // 8. Create OrderExchange record
      await tx.orderExchange.create({
        data: {
          orderId,
          originalItemId,
          exchangeItemId: exchangeItem.id,
          quantity,
          priceDifference: new Prisma.Decimal(priceDifference),
          accountId,
          transactionId,
        },
      });

      // 9. Update original order item status
      // Check if all quantity is exchanged
      const exchangedQuantity = await tx.orderExchange.aggregate({
        where: { originalItemId },
        _sum: { quantity: true },
      });
      const totalExchanged = exchangedQuantity._sum.quantity || 0;
      
      if (totalExchanged >= originalItem.quantity) {
        // All quantity exchanged
        await tx.orderItem.update({
          where: { id: originalItemId },
          data: { status: 'EXCHANGED' },
        });
      }

      // 10. Update inventory: remove from exchange product, add to original product
      // Remove exchange product from inventory
      await tx.inventory.update({
        where: {
          productId_warehouseId: {
            productId: exchangeProductId,
            warehouseId: exchangeInventory.warehouseId,
          },
        },
        data: {
          quantity: {
            decrement: quantity,
          },
        },
      });

      // Add original product back to inventory
      const originalWarehouse = await tx.warehouse.findFirst({
        where: { isVirtual: false },
        take: 1,
      });

      if (originalWarehouse) {
        const existingOriginalInventory = await tx.inventory.findUnique({
          where: {
            productId_warehouseId: {
              productId: originalItem.productId,
              warehouseId: originalWarehouse.id,
            },
          },
        });

        if (existingOriginalInventory) {
          await tx.inventory.update({
            where: {
              productId_warehouseId: {
                productId: originalItem.productId,
                warehouseId: originalWarehouse.id,
              },
            },
            data: {
              quantity: {
                increment: quantity,
              },
            },
          });
        } else {
          await tx.inventory.create({
            data: {
              productId: originalItem.productId,
              warehouseId: originalWarehouse.id,
              quantity,
            },
          });
        }
      }
    });

    revalidatePath('/dashboard/sales/history');
    revalidatePath(`/dashboard/sales/history/${orderId}`);
    revalidatePath('/dashboard/inventory');
    return {
      message: 'تعویض کالا با موفقیت ثبت شد.',
      success: true,
    };
  } catch (error: any) {
    console.error('Error exchanging order item:', error);
    return {
      message: error.message || 'خطا در ثبت تعویض کالا.',
      success: false,
    };
  }
}

export async function getOrderExchanges(orderId: string) {
  try {
    const exchanges = await prisma.orderExchange.findMany({
      where: { orderId },
      include: {
        originalItem: {
          include: { product: true },
        },
        exchangeItem: {
          include: { product: true },
        },
        account: true,
        transaction: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return exchanges.map((ex) => ({
      ...ex,
      priceDifference: Number(ex.priceDifference),
    }));
  } catch (error) {
    console.error('Error fetching order exchanges:', error);
    return [];
  }
}
