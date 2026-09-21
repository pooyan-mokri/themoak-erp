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
import { CASH_CHANGED_MESSAGE, exchangeChange, lineValue, orderMoney, receivableNow } from '@/lib/return-math';

const OrderExchangeSchema = z.object({
  orderId: z.string().min(1, 'شناسه سفارش الزامی است'),
  originalItemId: z.string().min(1, 'شناسه آیتم اصلی الزامی است'),
  exchangeProductId: z.string().min(1, 'کالای تعویضی الزامی است'),
  quantity: z.coerce.number().int().positive('تعداد باید بیشتر از صفر باشد'),
  accountId: z.string().min(1, 'حساب الزامی است'),
  returnWarehouseId: z.string().min(1, 'انبار برگشت کالا الزامی است'),
  exchangeWarehouseId: z.string().min(1, 'انبار تحویل کالا الزامی است'),
  // Of a positive difference, what the cashier collects now; the rest is owed on the order.
  receivedNow: z.coerce.number().min(0, 'مبلغ دریافتی نمی‌تواند منفی باشد').optional(),
  // The cash the dialog showed; the server refuses when its own figure differs.
  expectedCash: z.coerce.number().optional(),
});

export async function exchangeOrderItem(prevState: any, formData: FormData) {
  const denied = await checkPermission('sales.manage');
  if (denied) return { message: denied.message, success: false };
  const validatedFields = OrderExchangeSchema.safeParse({
    orderId: formData.get('orderId'),
    originalItemId: formData.get('originalItemId'),
    exchangeProductId: formData.get('exchangeProductId'),
    quantity: formData.get('quantity'),
    accountId: formData.get('accountId'),
    returnWarehouseId: formData.get('returnWarehouseId'),
    exchangeWarehouseId: formData.get('exchangeWarehouseId'),
    receivedNow: formData.get('receivedNow') || undefined,
    expectedCash: formData.get('expectedCash') || undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
      success: false,
    };
  }

  const { orderId, originalItemId, exchangeProductId, quantity, accountId, returnWarehouseId, exchangeWarehouseId, receivedNow, expectedCash } = validatedFields.data;
  // Of a negative difference, the customer gets cash back only when the cashier chooses it.
  const refundNow = formData.get('refundNow') === '1';
  const requestId = readRequestId(formData.get('requestId'));

  try {
    const outcome = await prisma.$transaction(async (tx: any) => {
      // One return or exchange at a time per order: the second re-reads what the first left.
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      if (requestId && (await tx.transaction.findUnique({ where: { clientRequestId: requestId }, select: { id: true } }))) {
        return 'duplicate';
      }

      // 1. Get order and original item
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          customer: true,
          items: {
            include: { product: true },
          },
          commissions: true,
        },
      });

      if (!order) {
        throw new Error('سفارش یافت نشد.');
      }

      // Website orders are reversed on the website; doing it here too would
      // move their money and stock a second time.
      if (order.siteReference != null) {
        throw new Error(WEBSITE_ORDER_LOCKED);
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

      // Block re-exchanging an item that was itself created by a previous
      // exchange — that would chain A→B→C and make accounting (and history)
      // a tangle. Returns on such an item remain allowed.
      const isExchangeDerived = await tx.orderExchange.findFirst({
        where: { exchangeItemId: originalItemId },
        select: { id: true },
      });
      if (isExchangeDerived) {
        throw new Error('این آیتم خود حاصل یک تعویض است و دوباره قابل تعویض نیست. در صورت نیاز می‌توانید آن را عودت کنید.');
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

      // 4. Calculate price difference (each side net of the partner's
      //    commission on a consignment sale, whose total is stored net)
      const money = orderMoney(order);
      const originalPrice = lineValue(money, Number(originalItem.price), quantity);
      const exchangePrice = lineValue(money, Number(exchangeProduct.sellPrice), quantity);
      const priceDifference = exchangePrice - originalPrice;
      // A credit the customer holds on the order pays the difference first.
      const receivable = receivableNow(money, priceDifference);
      if ((receivedNow ?? 0) > receivable + 0.01) {
        throw new Error(
          receivable < priceDifference - 0.01
            ? `مشتری روی این سفارش اعتبار دارد؛ مبلغ دریافتی نمی‌تواند بیشتر از ${receivable.toLocaleString('fa-IR')} تومان باشد.`
            : 'مبلغ دریافتی نمی‌تواند بیشتر از مابه‌التفاوت باشد.',
        );
      }

      // 5. Recompute order totals (src/lib/return-math.ts; the dialog shows
      //    the same figures from the same function).
      //    - priceDifference > 0  → owed on the order, except what the
      //      cashier collects now (receivedNow).
      //    - priceDifference < 0  → only the portion the customer actually
      //      overpaid relative to the new total can go back, and only when
      //      the cashier chooses to refund it; otherwise it stays paid on the
      //      order as the customer's credit.
      const change = exchangeChange(money, priceDifference, { receivedNow, refundNow });
      const txType: TransactionType | null =
        change.cashIn > 0 ? TransactionType.INCOME : change.cashOut > 0 ? TransactionType.EXPENSE : null;
      const txAmount = change.cashIn || change.cashOut;
      if (expectedCash !== undefined && Math.abs(expectedCash - txAmount) > 0.01) {
        throw new Error(CASH_CHANGED_MESSAGE);
      }

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

        // Order amounts are in TOMAN; convert to the account's currency
        // when needed.
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
        const amountInAccountCurrency = txAmount / rate;

        const customerLabel = order.customer?.name ?? 'مشتری عمومی';
        const transaction = await tx.transaction.create({
          data: {
            type: txType,
            amount: new Prisma.Decimal(amountInAccountCurrency),
            currency: account.currency,
            rateSnapshot: new Prisma.Decimal(rate),
            amountInToman: new Prisma.Decimal(txAmount),
            accountId,
            customerId: order.customerId ?? undefined,
            orderId,
            clientRequestId: requestId ?? undefined,
            description: `تعویض کالا - سفارش #${order.number} - ${customerLabel} - ${originalItem.product.name} → ${exchangeProduct.name}`,
            category: 'Exchange',
            date: new Date(),
          },
        });
        transactionId = transaction.id;

        await tx.account.update({
          where: { id: accountId },
          data: txType === TransactionType.INCOME
            ? { balance: { increment: new Prisma.Decimal(amountInAccountCurrency) } }
            : { balance: { decrement: new Prisma.Decimal(amountInAccountCurrency) } },
        });
      }

      // 7. Persist new order totals
      await tx.order.update({
        where: { id: orderId },
        data: {
          totalAmount: new Prisma.Decimal(change.newTotal),
          paidAmount: new Prisma.Decimal(change.newPaid),
          paymentStatus: change.paymentStatus,
        },
      });

      // 7a. Keep an issued invoice in sync with the new order totals.
      await syncInvoiceWithOrder(orderId, tx);

      // 7b. For consignment sales, move each commission record by the gross
      //     price difference (the record is kept at gross prices).
      const orderCommissions = await tx.consignmentCommission.findMany({
        where: { orderId },
      });
      if (orderCommissions.length > 0) {
        const oldCommissionBase = orderCommissions.reduce(
          (sum: number, c: any) => sum + Number(c.orderAmount),
          0
        );
        const grossDifference = (Number(exchangeProduct.sellPrice) - Number(originalItem.price)) * quantity;
        const newCommissionBase = Math.max(0, oldCommissionBase + grossDifference);
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
      return 'done';
    });
    if (outcome === 'duplicate') return { message: DUPLICATE_REQUEST_MESSAGE, success: true };
    kickSiteHook();

    // Inventory, POS, customer debt list, accounting reports all derive
    // from this order's data — revalidate the whole dashboard so none of
    // them keep serving the pre-exchange snapshot.
    revalidatePath('/dashboard', 'layout');
    return {
      message: 'تعویض کالا با موفقیت ثبت شد.',
      success: true,
    };
  } catch (error: any) {
    if (isDuplicateRequest(error)) return { message: DUPLICATE_REQUEST_MESSAGE, success: true };
    console.error('Error exchanging order item:', error);
    return {
      message: error.message || 'خطا در ثبت تعویض کالا.',
      success: false,
    };
  }
}

export async function getAllOrderExchanges(limit = 200) {
  await requirePermission('sales.view');
  try {
    const exchanges = await prisma.orderExchange.findMany({
      include: {
        order: { include: { customer: true } },
        originalItem: { include: { product: true } },
        exchangeItem: { include: { product: true } },
        account: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return exchanges.map((ex: any) => ({
      id: ex.id,
      orderId: ex.orderId,
      orderNumber: ex.order?.number,
      customerName: ex.order?.customer?.name ?? 'مشتری عمومی',
      originalProductName: ex.originalItem?.product?.name ?? '—',
      exchangeProductName: ex.exchangeItem?.product?.name ?? '—',
      quantity: ex.quantity,
      priceDifference: Number(ex.priceDifference),
      accountName: ex.account?.name ?? '—',
      createdAt: ex.createdAt,
    }));
  } catch (error) {
    console.error('Error fetching all order exchanges:', error);
    return [];
  }
}

export async function getOrderExchanges(orderId: string) {
  await requirePermission('sales.view');
  const [canSeeCost, canSeeBalance] = await Promise.all([hasPermission('cost.view'), hasPermission('finance.view')]);
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
        product: ex.originalItem.product ? productForViewer(ex.originalItem.product, canSeeCost) : undefined,
      } : undefined,
      exchangeItem: ex.exchangeItem ? {
        ...ex.exchangeItem,
        product: ex.exchangeItem.product ? productForViewer(ex.exchangeItem.product, canSeeCost) : undefined,
      } : undefined,
      account: ex.account ? accountForViewer(ex.account, canSeeBalance) : undefined,
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
