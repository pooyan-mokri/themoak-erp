'use server';

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { TransactionType } from '@prisma/client';
import { accountForViewer, productForViewer, syncInvoiceWithOrder } from '@/lib/sales-records';
import { checkPermission, hasPermission, requirePermission } from '@/lib/access';
import { WEBSITE_ORDER_LOCKED } from '@/lib/site-sale-data';
import { kickSiteHook } from '@/lib/site-hook';
import { DUPLICATE_REQUEST_MESSAGE, isDuplicateRequest, readRequestId } from '@/lib/request-id';
import { CASH_CHANGED_MESSAGE, lineValue, orderMoney, returnChange } from '@/lib/return-math';

const OrderReturnSchema = z.object({
  orderId: z.string().min(1, 'شناسه سفارش الزامی است'),
  orderItemId: z.string().min(1, 'شناسه آیتم سفارش الزامی است'),
  quantity: z.coerce.number().int().positive('تعداد باید بیشتر از صفر باشد'),
  reason: z.string().optional(),
  accountId: z.string().min(1, 'حساب الزامی است'),
  warehouseId: z.string().min(1, 'انبار الزامی است'),
  // The refund the dialog showed; the server refuses when its own figure differs.
  expectedCash: z.coerce.number().optional(),
});

export async function returnOrderItem(prevState: any, formData: FormData) {
  const denied = await checkPermission('sales.manage');
  if (denied) return { message: denied.message, success: false };
  const validatedFields = OrderReturnSchema.safeParse({
    orderId: formData.get('orderId'),
    orderItemId: formData.get('orderItemId'),
    quantity: formData.get('quantity'),
    reason: formData.get('reason') || undefined,
    accountId: formData.get('accountId'),
    warehouseId: formData.get('warehouseId'),
    expectedCash: formData.get('expectedCash') || undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
      success: false,
    };
  }

  const { orderId, orderItemId, quantity, reason, accountId, warehouseId, expectedCash } = validatedFields.data;
  const requestId = readRequestId(formData.get('requestId'));

  try {
    const outcome = await prisma.$transaction(async (tx: any) => {
      // One return or exchange at a time per order: the second re-reads what the first left.
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      if (requestId && (await tx.transaction.findUnique({ where: { clientRequestId: requestId }, select: { id: true } }))) {
        return 'duplicate';
      }

      // 1. Get order and order item
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          customer: true,
          items: {
            // Returns and exchanges tell orderMoney whether the total is stored net of commission.
            include: { product: true, returns: { select: { quantity: true } }, exchanges: { select: { quantity: true } } },
          },
          commissions: true,
        },
      });

      if (!order) {
        throw new Error('سفارش یافت نشد.');
      }

      // Website orders are reversed on the website; doing it here too would
      // refund and restock them a second time.
      if (order.siteReference != null) {
        throw new Error(WEBSITE_ORDER_LOCKED);
      }

      if (order.status === 'CANCELLED') {
        throw new Error('این سفارش لغو شده و امکان عودت ندارد.');
      }

      const orderItem = order.items.find((item: any) => item.id === orderItemId);
      if (!orderItem) {
        throw new Error('آیتم سفارش یافت نشد.');
      }

      if (orderItem.status === 'RETURNED' || orderItem.status === 'EXCHANGED') {
        throw new Error('این آیتم قبلاً عودت یا تعویض شده است.');
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

      // Virtual warehouses are only valid as a return destination when the
      // sale was consignment AND the warehouse belongs to the same partner
      // (the customer on the order).
      const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId } });
      if (!warehouse) {
        throw new Error('انبار یافت نشد.');
      }
      if (warehouse.isVirtual && warehouse.customerId !== order.customerId) {
        throw new Error('این انبار مجازی متعلق به مشتری این سفارش نیست.');
      }

      // 2. Value of the returned goods to this order: net of the partner's
      //    commission on a consignment sale, whose total is stored net.
      const money = orderMoney(order);
      const refundAmount = lineValue(money, Number(orderItem.price), quantity);

      // 3. Recompute order totals. Cash leaves the account ONLY for the
      //    portion the customer actually overpaid relative to the new total
      //    (i.e. only what's owed back). The rest just cancels customer debt.
      //    The dialog shows the same figure from the same function.
      const change = returnChange(money, refundAmount);
      const cashRefund = change.cashOut;
      if (expectedCash !== undefined && Math.abs(expectedCash - cashRefund) > 0.01) {
        throw new Error(CASH_CHANGED_MESSAGE);
      }

      // 4. Cash refund leg (skipped entirely when nothing leaves the account)
      let transactionId: string | undefined;
      if (cashRefund > 0) {
        const account = await tx.account.findUnique({ where: { id: accountId } });
        if (!account) {
          throw new Error('حساب یافت نشد.');
        }

        if (account.type !== 'BANK' && account.type !== 'CASH') {
          throw new Error('برای بازگرداندن وجه، حساب باید از نوع بانک یا صندوق باشد.');
        }

        // Order amounts are in TOMAN; convert to the account's currency
        // when needed so foreign-currency accounts stay consistent.
        let rate = 1;
        if (account.currency !== 'TOMAN') {
          const latestRate = await tx.exchangeRate.findFirst({
            where: { currency: account.currency },
            orderBy: { date: 'desc' },
          });
          if (!latestRate) {
            throw new Error(`نرخ تبدیل برای ارز ${account.currency} یافت نشد. لطفا ابتدا نرخ امروز را وارد کنید.`);
          }
          rate = Number(latestRate.rateToToman);
        }
        const amountInAccountCurrency = cashRefund / rate;

        const customerLabel = order.customer?.name ?? 'مشتری عمومی';
        const transaction = await tx.transaction.create({
          data: {
            type: TransactionType.EXPENSE,
            amount: new Prisma.Decimal(amountInAccountCurrency),
            currency: account.currency,
            rateSnapshot: new Prisma.Decimal(rate),
            amountInToman: new Prisma.Decimal(cashRefund),
            accountId,
            customerId: order.customerId ?? undefined,
            orderId,
            clientRequestId: requestId ?? undefined,
            description: `عودت کالا - سفارش #${order.number} - ${customerLabel} - ${orderItem.product.name}`,
            category: 'Return',
            date: new Date(),
          },
        });
        transactionId = transaction.id;

        await tx.account.update({
          where: { id: accountId },
          data: { balance: { decrement: new Prisma.Decimal(amountInAccountCurrency) } },
        });
      }

      // 5. Persist the order totals so debt/LTV/reports stay consistent
      await tx.order.update({
        where: { id: orderId },
        data: {
          totalAmount: new Prisma.Decimal(change.newTotal),
          paidAmount: new Prisma.Decimal(change.newPaid),
          paymentStatus: change.paymentStatus,
        },
      });

      // 5a. Keep the (already-issued) invoice in sync with the order so it
      //     doesn't keep displaying the pre-return total / paid amounts.
      await syncInvoiceWithOrder(orderId, tx);

      // 5b. For consignment sales, take the returned goods (at their gross
      //     price, like the record) off each commission record on this
      //     order so the partner isn't paid commission on goods that came back.
      const orderCommissions = await tx.consignmentCommission.findMany({
        where: { orderId },
      });
      if (orderCommissions.length > 0) {
        const oldCommissionBase = orderCommissions.reduce(
          (sum: number, c: any) => sum + Number(c.orderAmount),
          0
        );
        const newCommissionBase = Math.max(0, oldCommissionBase - Number(orderItem.price) * quantity);
        const ratio = oldCommissionBase > 0 ? newCommissionBase / oldCommissionBase : 0;
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
      return 'done';
    });
    if (outcome === 'duplicate') return { message: DUPLICATE_REQUEST_MESSAGE, success: true };
    kickSiteHook();

    // Inventory, POS, customer debt list, accounting reports all derive
    // from this order's data — revalidate the whole dashboard so none of
    // them keep serving the pre-return snapshot.
    revalidatePath('/dashboard', 'layout');
    return {
      message: 'عودت کالا با موفقیت ثبت شد.',
      success: true,
    };
  } catch (error: any) {
    if (isDuplicateRequest(error)) return { message: DUPLICATE_REQUEST_MESSAGE, success: true };
    console.error('Error returning order item:', error);
    return {
      message: error.message || 'خطا در ثبت عودت کالا.',
      success: false,
    };
  }
}

/**
 * What the return and exchange dialogs need to show the cash exactly as the
 * server will book it (src/lib/return-math.ts), and the account the sale was
 * paid into, which they offer first for a refund.
 */
export async function getOrderMoney(orderId: string) {
  await requirePermission('sales.view');
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      commissions: true,
      transaction: { include: { account: true } },
      items: { include: { returns: { select: { quantity: true } }, exchanges: { select: { quantity: true } } } },
    },
  });
  if (!order) return null;
  const checkout = order.transaction?.account;
  let saleAccountId = checkout && (checkout.type === 'BANK' || checkout.type === 'CASH') ? checkout.id : null;
  if (!saleAccountId) {
    const payment = await prisma.transaction.findFirst({
      where: { orderId, type: 'INCOME', account: { type: { in: ['BANK', 'CASH'] } } },
      orderBy: { createdAt: 'desc' },
      select: { accountId: true },
    });
    saleAccountId = payment?.accountId ?? null;
  }
  return { ...orderMoney(order), saleAccountId };
}

export async function getAllOrderReturns(limit = 200) {
  await requirePermission('sales.view');
  try {
    const returns = await prisma.orderReturn.findMany({
      include: {
        order: { include: { customer: true } },
        orderItem: { include: { product: true } },
        account: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return returns.map((ret: any) => ({
      id: ret.id,
      orderId: ret.orderId,
      orderNumber: ret.order?.number,
      customerName: ret.order?.customer?.name ?? 'مشتری عمومی',
      productName: ret.orderItem?.product?.name ?? '—',
      quantity: ret.quantity,
      refundAmount: Number(ret.refundAmount),
      reason: ret.reason ?? undefined,
      accountName: ret.account?.name ?? '—',
      createdAt: ret.createdAt,
    }));
  } catch (error) {
    console.error('Error fetching all order returns:', error);
    return [];
  }
}

export async function getOrderReturns(orderId: string) {
  await requirePermission('sales.view');
  const [canSeeCost, canSeeBalance] = await Promise.all([hasPermission('cost.view'), hasPermission('finance.view')]);
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
        product: ret.orderItem.product ? productForViewer(ret.orderItem.product, canSeeCost) : undefined,
      } : undefined,
      account: ret.account ? accountForViewer(ret.account, canSeeBalance) : undefined,
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
