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
  returnWarehouseId: z.string().min(1, 'انبار برگشت کالا الزامی است'),
  exchangeWarehouseId: z.string().min(1, 'انبار تحویل کالا الزامی است'),
});

export async function exchangeOrderItem(prevState: any, formData: FormData) {
  const validatedFields = OrderExchangeSchema.safeParse({
    orderId: formData.get('orderId'),
    originalItemId: formData.get('originalItemId'),
    exchangeProductId: formData.get('exchangeProductId'),
    quantity: formData.get('quantity'),
    accountId: formData.get('accountId'),
    returnWarehouseId: formData.get('returnWarehouseId'),
    exchangeWarehouseId: formData.get('exchangeWarehouseId'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
      success: false,
    };
  }

  const { orderId, originalItemId, exchangeProductId, quantity, accountId, returnWarehouseId, exchangeWarehouseId } = validatedFields.data;

  try {
    await prisma.$transaction(async (tx: any) => {
      // 1. Get order and original item
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          customer: true,
          items: {
            include: { product: true },
          },
        },
      });

      if (!order) {
        throw new Error('سفارش یافت نشد.');
      }

      if (order.status === 'CANCELLED') {
        throw new Error('این سفارش لغو شده و امکان تعویض ندارد.');
      }

      const originalItem = order.items.find((item: any) => item.id === originalItemId);
      if (!originalItem) {
        throw new Error('آیتم اصلی یافت نشد.');
      }

      if (originalItem.status === 'RETURNED' || originalItem.status === 'EXCHANGED') {
        throw new Error('این آیتم قبلاً عودت یا تعویض شده است.');
      }

      // باقی‌ماندهٔ مجاز برای تعویض = تعداد اولیه − عودت‌های قبلی − تعویض‌های قبلی
      const [returnedAgg, exchangedAgg] = await Promise.all([
        tx.orderReturn.aggregate({
          where: { orderItemId: originalItemId },
          _sum: { quantity: true },
        }),
        tx.orderExchange.aggregate({
          where: { originalItemId },
          _sum: { quantity: true },
        }),
      ]);
      const alreadyReturned = returnedAgg._sum.quantity || 0;
      const alreadyExchanged = exchangedAgg._sum.quantity || 0;
      const remaining = originalItem.quantity - alreadyReturned - alreadyExchanged;

      if (remaining <= 0) {
        throw new Error('این آیتم قبلاً به‌طور کامل عودت یا تعویض شده است.');
      }

      if (quantity > remaining) {
        throw new Error(`تعداد تعویض بیش از باقی‌ماندهٔ مجاز است (باقی‌مانده: ${remaining}).`);
      }

      // Virtual warehouses are only valid in this flow when the sale was
      // consignment AND the warehouse belongs to the order's customer.
      const [returnWarehouse, exchangeWarehouseRecord] = await Promise.all([
        tx.warehouse.findUnique({ where: { id: returnWarehouseId } }),
        tx.warehouse.findUnique({ where: { id: exchangeWarehouseId } }),
      ]);
      if (!returnWarehouse) {
        throw new Error('انبار برگشت کالا یافت نشد.');
      }
      if (!exchangeWarehouseRecord) {
        throw new Error('انبار تحویل کالا یافت نشد.');
      }
      if (returnWarehouse.isVirtual && returnWarehouse.customerId !== order.customerId) {
        throw new Error('انبار برگشت مجازی متعلق به مشتری این سفارش نیست.');
      }
      if (exchangeWarehouseRecord.isVirtual && exchangeWarehouseRecord.customerId !== order.customerId) {
        throw new Error('انبار تحویل مجازی متعلق به مشتری این سفارش نیست.');
      }

      // 2. Get exchange product
      const exchangeProduct = await tx.product.findUnique({
        where: { id: exchangeProductId },
      });

      if (!exchangeProduct) {
        throw new Error('کالای تعویضی یافت نشد.');
      }

      // 3. Check inventory for exchange product in the selected warehouse
      const exchangeInventory = await tx.inventory.findUnique({
        where: {
          productId_warehouseId: {
            productId: exchangeProductId,
            warehouseId: exchangeWarehouseId,
          },
        },
      });

      if (!exchangeInventory || exchangeInventory.quantity < quantity) {
        throw new Error(`موجودی کافی برای کالای تعویضی "${exchangeProduct.name}" در انبار انتخابی وجود ندارد.`);
      }

      // 4. Calculate price difference
      const originalPrice = Number(originalItem.price) * quantity;
      const exchangePrice = Number(exchangeProduct.sellPrice) * quantity;
      const priceDifference = exchangePrice - originalPrice;

      // 5. Recompute order totals.
      //    - priceDifference > 0  → cashier collects the extra at the till
      //      (matches existing UX where account is mandatory).
      //    - priceDifference < 0  → only refund the portion the customer
      //      actually overpaid relative to the new total. The rest is
      //      absorbed by reducing the outstanding debt on the order.
      const oldTotal = Number(order.totalAmount);
      const oldDiscount = Number(order.discount);
      const oldPaid = Number(order.paidAmount);

      const newTotal = Math.max(0, oldTotal + priceDifference);
      const newNetOwed = Math.max(0, newTotal - oldDiscount);

      let txType: TransactionType | null = null;
      let txAmount = 0;
      let newPaid = oldPaid;

      if (priceDifference > 0) {
        txType = TransactionType.INCOME;
        txAmount = priceDifference;
        newPaid = oldPaid + priceDifference;
      } else if (priceDifference < 0) {
        if (oldPaid > newNetOwed) {
          txType = TransactionType.EXPENSE;
          txAmount = oldPaid - newNetOwed;
          newPaid = newNetOwed;
        }
      }

      const newDebt = newNetOwed - newPaid;
      const newPaymentStatus = newDebt > 0
        ? (newPaid > 0 ? 'PARTIAL' : 'UNPAID')
        : 'PAID';

      // 6. Cash leg (skipped when no money actually changes hands)
      let transactionId: string | undefined;
      if (txType !== null && txAmount > 0) {
        const account = await tx.account.findUnique({ where: { id: accountId } });
        if (!account) {
          throw new Error('حساب یافت نشد.');
        }

        if (account.type !== 'BANK' && account.type !== 'CASH') {
          throw new Error('برای تراکنش نقدی تعویض، حساب باید از نوع بانک یا صندوق باشد.');
        }

        const customerLabel = order.customer?.name ?? 'مشتری عمومی';
        const transaction = await tx.transaction.create({
          data: {
            type: txType,
            amount: txAmount,
            currency: 'TOMAN',
            rateSnapshot: 1,
            amountInToman: txAmount,
            accountId,
            customerId: order.customerId ?? undefined,
            description: `تعویض کالا - سفارش #${order.number} - ${customerLabel} - ${originalItem.product.name} → ${exchangeProduct.name}`,
            category: 'Exchange',
            date: new Date(),
          },
        });
        transactionId = transaction.id;

        await tx.account.update({
          where: { id: accountId },
          data: txType === TransactionType.INCOME
            ? { balance: { increment: txAmount } }
            : { balance: { decrement: txAmount } },
        });
      }

      // 7. Persist new order totals
      await tx.order.update({
        where: { id: orderId },
        data: {
          totalAmount: new Prisma.Decimal(newTotal),
          paidAmount: new Prisma.Decimal(newPaid),
          paymentStatus: newPaymentStatus,
        },
      });

      // 7b. For consignment sales, rescale commission records proportional
      //     to the new net order amount.
      const orderCommissions = await tx.consignmentCommission.findMany({
        where: { orderId },
      });
      if (orderCommissions.length > 0) {
        const oldCommissionBase = orderCommissions.reduce(
          (sum: number, c: any) => sum + Number(c.orderAmount),
          0
        );
        const ratio = oldCommissionBase > 0 ? newNetOwed / oldCommissionBase : 0;
        for (const commission of orderCommissions) {
          const rate = Number(commission.commissionRate);
          const newOrderAmount = Number(commission.orderAmount) * ratio;
          const newCommissionAmount = (newOrderAmount * rate) / 100;
          await tx.consignmentCommission.update({
            where: { id: commission.id },
            data: {
              orderAmount: new Prisma.Decimal(newOrderAmount),
              commissionAmount: new Prisma.Decimal(newCommissionAmount),
            },
          });
        }
      }

      // 8. Create exchange item in order (for record keeping)
      const exchangeItem = await tx.orderItem.create({
        data: {
          orderId,
          productId: exchangeProductId,
          quantity,
          price: new Prisma.Decimal(exchangeProduct.sellPrice),
          warehouseId: exchangeWarehouseId,
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

      // 10. Update inventory: deduct exchange product from selected warehouse,
      //     restore original product to the warehouse chosen by the user.
      await tx.inventory.update({
        where: {
          productId_warehouseId: {
            productId: exchangeProductId,
            warehouseId: exchangeWarehouseId,
          },
        },
        data: { quantity: { decrement: quantity } },
      });

      const existingReturnInventory = await tx.inventory.findUnique({
        where: {
          productId_warehouseId: {
            productId: originalItem.productId,
            warehouseId: returnWarehouseId,
          },
        },
      });

      if (existingReturnInventory) {
        await tx.inventory.update({
          where: {
            productId_warehouseId: {
              productId: originalItem.productId,
              warehouseId: returnWarehouseId,
            },
          },
          data: { quantity: { increment: quantity } },
        });
      } else {
        await tx.inventory.create({
          data: {
            productId: originalItem.productId,
            warehouseId: returnWarehouseId,
            quantity,
          },
        });
      }
    });

    // Note: we intentionally do NOT cancel the WooCommerce order on
    // exchange. The customer received goods (the replacement product), so
    // the Woo order remains a real fulfilled order. Cancelling it here was
    // incorrect — it wiped the entire Woo order even for a single-line
    // swap.

    // Inventory, POS, customer debt list, accounting reports all derive
    // from this order's data — revalidate the whole dashboard so none of
    // them keep serving the pre-exchange snapshot.
    revalidatePath('/dashboard', 'layout');
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

    return exchanges.map((ex: any) => ({
      ...ex,
      priceDifference: Number(ex.priceDifference),
      transactionId: ex.transactionId ?? undefined,
      originalItem: ex.originalItem ? {
        ...ex.originalItem,
        product: ex.originalItem.product ? {
          ...ex.originalItem.product,
          image: ex.originalItem.product.image ?? undefined,
          wooId: ex.originalItem.product.wooId ?? undefined,
          barcode: ex.originalItem.product.barcode ?? undefined,
        } : undefined,
      } : undefined,
      exchangeItem: ex.exchangeItem ? {
        ...ex.exchangeItem,
        product: ex.exchangeItem.product ? {
          ...ex.exchangeItem.product,
          image: ex.exchangeItem.product.image ?? undefined,
          wooId: ex.exchangeItem.product.wooId ?? undefined,
          barcode: ex.exchangeItem.product.barcode ?? undefined,
        } : undefined,
      } : undefined,
      transaction: ex.transaction ? {
        ...ex.transaction,
        description: ex.transaction.description ?? undefined,
        category: ex.transaction.category ?? undefined,
        accountId: ex.transaction.accountId ?? undefined,
        projectId: ex.transaction.projectId ?? undefined,
        employeeId: ex.transaction.employeeId ?? undefined,
        shareholderId: ex.transaction.shareholderId ?? undefined,
        receiptUrl: ex.transaction.receiptUrl ?? undefined,
        wooId: ex.transaction.wooId ?? undefined,
        wooStatus: ex.transaction.wooStatus ?? undefined,
      } : undefined,
    }));
  } catch (error) {
    console.error('Error fetching order exchanges:', error);
    return [];
  }
}
