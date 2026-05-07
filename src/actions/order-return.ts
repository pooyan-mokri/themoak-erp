'use server';

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { TransactionType } from '@prisma/client';

const OrderReturnSchema = z.object({
  orderId: z.string().min(1, 'شناسه سفارش الزامی است'),
  orderItemId: z.string().min(1, 'شناسه آیتم سفارش الزامی است'),
  quantity: z.coerce.number().int().positive('تعداد باید بیشتر از صفر باشد'),
  reason: z.string().optional(),
  accountId: z.string().min(1, 'حساب الزامی است'),
  warehouseId: z.string().min(1, 'انبار الزامی است'),
});

export async function returnOrderItem(prevState: any, formData: FormData) {
  const validatedFields = OrderReturnSchema.safeParse({
    orderId: formData.get('orderId'),
    orderItemId: formData.get('orderItemId'),
    quantity: formData.get('quantity'),
    reason: formData.get('reason') || undefined,
    accountId: formData.get('accountId'),
    warehouseId: formData.get('warehouseId'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
      success: false,
    };
  }

  const { orderId, orderItemId, quantity, reason, accountId, warehouseId } = validatedFields.data;

  try {
    await prisma.$transaction(async (tx: any) => {
      // 1. Get order and order item
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

      const orderItem = order.items.find((item: any) => item.id === orderItemId);
      if (!orderItem) {
        throw new Error('آیتم سفارش یافت نشد.');
      }

      // باقی‌ماندهٔ مجاز برای عودت = تعداد اولیه − عودت‌های قبلی − تعویض‌های قبلی
      const [returnedAgg, exchangedAgg] = await Promise.all([
        tx.orderReturn.aggregate({
          where: { orderItemId },
          _sum: { quantity: true },
        }),
        tx.orderExchange.aggregate({
          where: { originalItemId: orderItemId },
          _sum: { quantity: true },
        }),
      ]);
      const alreadyReturned = returnedAgg._sum.quantity || 0;
      const alreadyExchanged = exchangedAgg._sum.quantity || 0;
      const remaining = orderItem.quantity - alreadyReturned - alreadyExchanged;

      if (remaining <= 0) {
        throw new Error('این آیتم قبلاً به‌طور کامل عودت یا تعویض شده است.');
      }

      if (quantity > remaining) {
        throw new Error(`تعداد عودت بیش از باقی‌ماندهٔ مجاز است (باقی‌مانده: ${remaining}).`);
      }

      // 2. Calculate refund value of returned goods
      const refundAmount = Number(orderItem.price) * quantity;

      // 3. Recompute order totals. Cash leaves the account ONLY for the
      //    portion the customer actually overpaid relative to the new total
      //    (i.e. only what's owed back). The rest just cancels customer debt.
      const oldTotal = Number(order.totalAmount);
      const oldDiscount = Number(order.discount);
      const oldPaid = Number(order.paidAmount);

      const newTotal = Math.max(0, oldTotal - refundAmount);
      const newNetOwed = Math.max(0, newTotal - oldDiscount);
      let cashRefund = 0;
      let newPaid = oldPaid;
      if (oldPaid > newNetOwed) {
        cashRefund = oldPaid - newNetOwed;
        newPaid = newNetOwed;
      }
      const newDebt = newNetOwed - newPaid;
      const newPaymentStatus = newDebt > 0
        ? (newPaid > 0 ? 'PARTIAL' : 'UNPAID')
        : 'PAID';

      // 4. Cash refund leg (skipped entirely when nothing leaves the account)
      let transactionId: string | undefined;
      if (cashRefund > 0) {
        const account = await tx.account.findUnique({ where: { id: accountId } });
        if (!account) {
          throw new Error('حساب یافت نشد.');
        }

        const transaction = await tx.transaction.create({
          data: {
            type: TransactionType.EXPENSE,
            amount: cashRefund,
            currency: 'TOMAN',
            rateSnapshot: 1,
            amountInToman: cashRefund,
            accountId,
            description: `عودت کالا - سفارش #${order.number} - ${orderItem.product.name}`,
            category: 'Return',
            date: new Date(),
          },
        });
        transactionId = transaction.id;

        await tx.account.update({
          where: { id: accountId },
          data: { balance: { decrement: cashRefund } },
        });
      }

      // 5. Persist the order totals so debt/LTV/reports stay consistent
      await tx.order.update({
        where: { id: orderId },
        data: {
          totalAmount: new Prisma.Decimal(newTotal),
          paidAmount: new Prisma.Decimal(newPaid),
          paymentStatus: newPaymentStatus,
        },
      });

      // 6. Create OrderReturn record (refundAmount = goods value;
      //    transactionId only set when cash actually moved)
      await tx.orderReturn.create({
        data: {
          orderId,
          orderItemId,
          quantity,
          reason: reason || undefined,
          refundAmount: new Prisma.Decimal(refundAmount),
          accountId,
          transactionId,
        },
      });

      // 7. Update order item status
      // Check if all quantity is returned
      const returnedQuantity = await tx.orderReturn.aggregate({
        where: { orderItemId },
        _sum: { quantity: true },
      });
      const totalReturned = returnedQuantity._sum.quantity || 0;
      
      if (totalReturned >= orderItem.quantity) {
        // All quantity returned
        await tx.orderItem.update({
          where: { id: orderItemId },
          data: { status: 'RETURNED' },
        });
      }

      // 7. Restore inventory to the warehouse selected by the user
      const existingInventory = await tx.inventory.findUnique({
        where: {
          productId_warehouseId: {
            productId: orderItem.productId,
            warehouseId,
          },
        },
      });

      if (existingInventory) {
        await tx.inventory.update({
          where: {
            productId_warehouseId: {
              productId: orderItem.productId,
              warehouseId,
            },
          },
          data: { quantity: { increment: quantity } },
        });
      } else {
        await tx.inventory.create({
          data: {
            productId: orderItem.productId,
            warehouseId,
            quantity,
          },
        });
      }
    });

    // 8. Cancel order in WooCommerce if it came from WooCommerce
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { wooId: true, number: true },
    });

    if (order?.wooId) {
      try {
        const { cancelOrderInWooCommerce } = await import('./woocommerce');
        const result = await cancelOrderInWooCommerce(order.wooId);
        if (result.success) {
          console.log(`[Return] سفارش WooCommerce #${order.number} (ID: ${order.wooId}) در WooCommerce لغو شد.`);
        } else {
          console.warn(`[Return] خطا در لغو سفارش در WooCommerce: ${result.message}`);
        }
      } catch (error) {
        console.error('[Return] خطا در لغو سفارش در WooCommerce:', error);
        // Don't fail the return process if WooCommerce cancellation fails
      }
    }

    revalidatePath('/dashboard/sales/history');
    revalidatePath(`/dashboard/sales/history/${orderId}`);
    return {
      message: 'عودت کالا با موفقیت ثبت شد.',
      success: true,
    };
  } catch (error: any) {
    console.error('Error returning order item:', error);
    return {
      message: error.message || 'خطا در ثبت عودت کالا.',
      success: false,
    };
  }
}

export async function getOrderReturns(orderId: string) {
  try {
    const returns = await prisma.orderReturn.findMany({
      where: { orderId },
      include: {
        orderItem: {
          include: { product: true },
        },
        account: true,
        transaction: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return returns.map((ret: any) => ({
      ...ret,
      reason: ret.reason ?? undefined,
      transactionId: ret.transactionId ?? undefined,
      refundAmount: Number(ret.refundAmount),
      orderItem: ret.orderItem ? {
        ...ret.orderItem,
        price: Number(ret.orderItem.price),
        product: ret.orderItem.product ? {
          ...ret.orderItem.product,
          costPrice: Number(ret.orderItem.product.costPrice),
          sellPrice: Number(ret.orderItem.product.sellPrice),
          image: ret.orderItem.product.image ?? undefined,
          wooId: ret.orderItem.product.wooId ?? undefined,
          barcode: ret.orderItem.product.barcode ?? undefined,
        } : undefined,
      } : undefined,
      account: ret.account ? {
        ...ret.account,
        balance: Number(ret.account.balance),
      } : undefined,
      transaction: ret.transaction ? {
        ...ret.transaction,
        amount: Number(ret.transaction.amount),
        amountInToman: Number(ret.transaction.amountInToman),
        rateSnapshot: Number(ret.transaction.rateSnapshot),
        accountId: ret.transaction.accountId ?? undefined,
        projectId: ret.transaction.projectId ?? undefined,
        description: ret.transaction.description ?? undefined,
        category: ret.transaction.category ?? undefined,
        wooId: ret.transaction.wooId ?? undefined,
        wooStatus: ret.transaction.wooStatus ?? undefined,
        receiptUrl: ret.transaction.receiptUrl ?? undefined,
        shareholderId: ret.transaction.shareholderId ?? undefined,
        employeeId: ret.transaction.employeeId ?? undefined,
      } : undefined,
    }));
  } catch (error) {
    console.error('Error fetching order returns:', error);
    return [];
  }
}
