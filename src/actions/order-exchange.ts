'use server';

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { z } from 'zod';
import { TransactionType } from '@prisma/client';
import { CREDIT_REASON, accountForViewer, productForViewer, syncInvoiceWithOrder } from '@/lib/sales-records';
import { checkPermission, hasPermission, requirePermission } from '@/lib/access';
import { WEBSITE_ORDER_LOCKED } from '@/lib/site-sale-data';
import { kickSiteHook } from '@/lib/site-hook';
import { DUPLICATE_REQUEST_MESSAGE, isDuplicateRequest, readRequestId } from '@/lib/request-id';
import { CASH_CHANGED_MESSAGE, exchangeChange, lineValue, orderMoney, receivableNow } from '@/lib/return-math';

const OrderExchangeSchema = z.object({
  orderId: z.string().min(1, 'شناسه سفارش الزامی است'),
  originalItemId: z.string().min(1, 'شناسه آیتم اصلی الزامی است'),
  // Units of the original line given back.
  quantity: z.coerce.number().int().positive('تعداد باید بیشتر از صفر باشد'),
  accountId: z.string().min(1, 'حساب الزامی است'),
  returnWarehouseId: z.string().min(1, 'انبار برگشت کالا الزامی است'),
  // One new product for as many units as come back, at its catalog price (the
  // one-for-one form); `lines` replaces both.
  exchangeProductId: z.string().optional(),
  exchangeWarehouseId: z.string().optional(),
  // Of a positive difference, what the cashier collects now; the rest is owed on the order.
  receivedNow: z.coerce.number().min(0, 'مبلغ دریافتی نمی‌تواند منفی باشد').optional(),
  // The cash the dialog showed; the server refuses when its own figure differs.
  expectedCash: z.coerce.number().optional(),
});

// The new goods: one or more lines, each from its own warehouse, at a price the
// cashier may change (the catalog price when none is given).
const ExchangeLineSchema = z.object({
  productId: z.string().min(1, 'کالای تعویضی الزامی است'),
  quantity: z.coerce.number().int().positive('تعداد کالای تعویضی باید بیشتر از صفر باشد'),
  price: z.coerce.number().min(0, 'قیمت کالای تعویضی نمی‌تواند منفی باشد').optional(),
  warehouseId: z.string().min(1, 'انبار تحویل کالا الزامی است'),
});
const ExchangeLinesSchema = z
  .array(ExchangeLineSchema)
  .min(1, 'دست‌کم یک کالای تعویضی لازم است')
  .max(20, 'حداکثر ۲۰ کالای تعویضی در یک تعویض');

type ExchangeLine = z.infer<typeof ExchangeLineSchema>;

/** The new lines of the form: `lines` (JSON), or the one-for-one fields. */
function readExchangeLines(formData: FormData, quantity: number, one: { productId?: string; warehouseId?: string }) {
  const raw = formData.get('lines');
  if (typeof raw === 'string' && raw.trim() !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { error: 'فهرست کالاهای تعویضی نامعتبر است.' };
    }
    const lines = ExchangeLinesSchema.safeParse(parsed);
    if (!lines.success) return { error: lines.error.issues[0]?.message ?? 'فهرست کالاهای تعویضی نامعتبر است.' };
    return { lines: lines.data };
  }
  if (!one.productId) return { error: 'کالای تعویضی الزامی است', field: 'exchangeProductId' };
  if (!one.warehouseId) return { error: 'انبار تحویل کالا الزامی است', field: 'exchangeWarehouseId' };
  return { lines: [{ productId: one.productId, quantity, warehouseId: one.warehouseId }] as ExchangeLine[] };
}

export async function exchangeOrderItem(prevState: any, formData: FormData) {
  const denied = await checkPermission('sales.manage');
  if (denied) return { message: denied.message, success: false };
  const validatedFields = OrderExchangeSchema.safeParse({
    orderId: formData.get('orderId'),
    originalItemId: formData.get('originalItemId'),
    quantity: formData.get('quantity'),
    accountId: formData.get('accountId'),
    returnWarehouseId: formData.get('returnWarehouseId'),
    exchangeProductId: formData.get('exchangeProductId') || undefined,
    exchangeWarehouseId: formData.get('exchangeWarehouseId') || undefined,
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

  const { orderId, originalItemId, quantity, accountId, returnWarehouseId, receivedNow, expectedCash } = validatedFields.data;
  const read = readExchangeLines(formData, quantity, {
    productId: validatedFields.data.exchangeProductId,
    warehouseId: validatedFields.data.exchangeWarehouseId,
  });
  if (!read.lines) {
    return {
      errors: read.field ? { [read.field]: [read.error] } : {},
      message: read.error,
      success: false,
    };
  }
  const lines = read.lines;
  // Of a negative difference, what the customer paid beyond the new total goes
  // back as cash (refundNow) or to their credit account (toCredit), as the cashier chooses.
  const refundNow = formData.get('refundNow') === '1';
  const toCredit = formData.get('toCredit') === '1';
  if (refundNow && toCredit) {
    return { message: 'مابه‌التفاوت یا پس داده می‌شود یا به اعتبار مشتری می‌رود، نه هر دو.', success: false };
  }
  const requestId = readRequestId(formData.get('requestId'));
  const userId = (await auth())?.user?.id ?? null;

  try {
    const outcome = await prisma.$transaction(async (tx: any) => {
      // One return or exchange at a time per order: the second re-reads what the first left.
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
      // A submission already booked: its exchange row carries the request id, whether or
      // not money moved (an even swap, a difference left as debt).
      if (
        requestId &&
        ((await tx.orderExchange.findUnique({ where: { clientRequestId: requestId }, select: { id: true } })) ||
          (await tx.transaction.findUnique({ where: { clientRequestId: requestId }, select: { id: true } })) ||
          (await tx.customerCredit.findUnique({ where: { clientRequestId: requestId }, select: { id: true } })))
      ) {
        return 'duplicate';
      }

      // 1. Get order and original item
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
      const isExchangeDerived =
        originalItem.exchangeId != null ||
        (await tx.orderExchange.findFirst({
          where: { exchangeItemId: originalItemId },
          select: { id: true },
        }));
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
      const warehouseIds = Array.from(new Set([returnWarehouseId, ...lines.map((line) => line.warehouseId)]));
      const warehouses = new Map(
        (await tx.warehouse.findMany({ where: { id: { in: warehouseIds } } })).map((w: any) => [w.id, w]),
      );
      const returnWarehouse: any = warehouses.get(returnWarehouseId);
      if (!returnWarehouse) {
        throw new Error('انبار برگشت کالا یافت نشد.');
      }
      if (returnWarehouse.isVirtual && returnWarehouse.customerId !== order.customerId) {
        throw new Error('انبار برگشت مجازی متعلق به مشتری این سفارش نیست.');
      }
      for (const line of lines) {
        const warehouse: any = warehouses.get(line.warehouseId);
        if (!warehouse) {
          throw new Error('انبار تحویل کالا یافت نشد.');
        }
        if (warehouse.isVirtual && warehouse.customerId !== order.customerId) {
          throw new Error('انبار تحویل مجازی متعلق به مشتری این سفارش نیست.');
        }
      }

      // 2. Get the new products (the returned product itself is allowed: a
      //    fresh unit for a faulty one).
      const products = new Map(
        (await tx.product.findMany({ where: { id: { in: lines.map((line) => line.productId) } } })).map((p: any) => [p.id, p]),
      );
      const newLines = lines.map((line) => {
        const product: any = products.get(line.productId);
        if (!product) {
          throw new Error('کالای تعویضی یافت نشد.');
        }
        return { ...line, product, price: line.price ?? Number(product.sellPrice) };
      });

      // 3. Check inventory of each new product in its warehouse (two lines of
      //    the same product and warehouse need their sum).
      const needed = new Map<string, { productId: string; warehouseId: string; name: string; quantity: number }>();
      for (const line of newLines) {
        const key = `${line.productId}|${line.warehouseId}`;
        const entry = needed.get(key) ?? { productId: line.productId, warehouseId: line.warehouseId, name: line.product.name, quantity: 0 };
        entry.quantity += line.quantity;
        needed.set(key, entry);
      }
      for (const need of needed.values()) {
        const stock = await tx.inventory.findUnique({
          where: { productId_warehouseId: { productId: need.productId, warehouseId: need.warehouseId } },
        });
        if (!stock || stock.quantity < need.quantity) {
          throw new Error(`موجودی کافی برای کالای تعویضی "${need.name}" در انبار انتخابی وجود ندارد.`);
        }
      }

      // 4. Value of each side (net of the partner's commission on a
      //    consignment sale, whose total is stored net). The goods given back
      //    take their share of the order discount with them; the new goods
      //    carry none.
      const money = orderMoney(order);
      const originalPrice = lineValue(money, Number(originalItem.price), quantity);
      const exchangePrice = newLines.reduce((sum, line) => sum + lineValue(money, line.price, line.quantity), 0);

      // 5. Recompute order totals (src/lib/return-math.ts; the dialog shows
      //    the same figures from the same function).
      //    - the bill grows → owed on the order, except what the cashier
      //      collects now (receivedNow).
      //    - the bill shrinks → what the customer paid beyond the new total
      //      goes back as cash (refundNow) or to their credit account
      //      (toCredit); with neither it stays paid on the order.
      if (toCredit && !order.customerId) {
        throw new Error('این سفارش مشتری ندارد؛ مابه‌التفاوت را فقط می‌توان نقدی پس داد.');
      }
      const change = exchangeChange(money, originalPrice, exchangePrice, { receivedNow, refundNow, toCredit });
      // What the exchange added to (or took off) the customer's bill.
      const priceDifference = change.owedChange;
      // A credit the customer holds on the order pays the difference first.
      const receivable = receivableNow(money, originalPrice, exchangePrice);
      if ((receivedNow ?? 0) > receivable + 0.01) {
        throw new Error(
          receivable < priceDifference - 0.01
            ? `مشتری روی این سفارش اعتبار دارد؛ مبلغ دریافتی نمی‌تواند بیشتر از ${receivable.toLocaleString('fa-IR')} تومان باشد.`
            : 'مبلغ دریافتی نمی‌تواند بیشتر از مابه‌التفاوت باشد.',
        );
      }
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
        const newNames = newLines.map((line) => line.product.name).join('، ');
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
            description: `تعویض کالا - سفارش #${order.number} - ${customerLabel} - ${originalItem.product.name} → ${newNames}`,
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
          discount: new Prisma.Decimal(change.newDiscount),
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
        const grossDifference =
          newLines.reduce((sum, line) => sum + line.price * line.quantity, 0) - Number(originalItem.price) * quantity;
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

      // 8. The new lines, on the same order, each marked with this exchange.
      const issued: any[] = [];
      for (const line of newLines) {
        issued.push(
          await tx.orderItem.create({
            data: {
              orderId,
              productId: line.productId,
              quantity: line.quantity,
              price: new Prisma.Decimal(line.price),
              warehouseId: line.warehouseId,
            },
          }),
        );
      }

      // 8. Create OrderExchange record (exchangeItemId: the first new line)
      const exchange = await tx.orderExchange.create({
        data: {
          orderId,
          originalItemId,
          exchangeItemId: issued[0].id,
          quantity,
          priceDifference: new Prisma.Decimal(priceDifference),
          accountId,
          transactionId,
          clientRequestId: requestId ?? undefined,
        },
      });
      await tx.orderItem.updateMany({
        where: { id: { in: issued.map((item) => item.id) } },
        data: { exchangeId: exchange.id },
      });

      // 8a. What the customer paid beyond the new total and left with the
      //     shop goes to their credit account.
      if (change.creditIn > 0) {
        await tx.customerCredit.create({
          data: {
            customerId: order.customerId,
            amount: new Prisma.Decimal(change.creditIn),
            orderId,
            exchangeId: exchange.id,
            reason: CREDIT_REASON.EXCHANGE,
            userId: userId ?? undefined,
            clientRequestId: requestId ?? undefined,
          },
        });
      }

      // 9. Update original order item status: this exchange leaves none of
      //    the line sold (earlier returns and exchanges took the rest).
      if (quantity >= remaining) {
        await tx.orderItem.update({
          where: { id: originalItemId },
          data: { status: 'EXCHANGED' },
        });
      }

      // 10. Update inventory: deduct each new line from its warehouse,
      //     restore the original product to the warehouse chosen by the user.
      for (const need of needed.values()) {
        await tx.inventory.update({
          where: {
            productId_warehouseId: {
              productId: need.productId,
              warehouseId: need.warehouseId,
            },
          },
          data: { quantity: { decrement: need.quantity } },
        });
      }

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

/** The names of the goods an exchange issued; an exchange from before exchangeId issued exchangeItem only. */
function issuedNames(ex: any): string {
  const items = ex.issuedItems?.length ? ex.issuedItems : ex.exchangeItem ? [ex.exchangeItem] : [];
  return items.length ? items.map((item: any) => `${item.product?.name ?? '—'} × ${item.quantity}`).join('، ') : '—';
}

export async function getAllOrderExchanges(limit = 200) {
  await requirePermission('sales.view');
  try {
    const exchanges = await prisma.orderExchange.findMany({
      include: {
        order: { include: { customer: true } },
        originalItem: { include: { product: true } },
        exchangeItem: { include: { product: true } },
        issuedItems: { include: { product: true }, orderBy: { id: 'asc' } },
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
      exchangeProductName: issuedNames(ex),
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
        issuedItems: { include: { product: true }, orderBy: { id: 'asc' } },
        credits: { select: { amount: true } },
        account: true,
        transaction: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return exchanges.map(({ issuedItems, credits, ...ex }: any) => ({
      ...ex,
      priceDifference: Number(ex.priceDifference),
      // The new goods, and what of the difference went to the customer's credit.
      issuedNames: issuedNames({ ...ex, issuedItems }),
      toCredit: credits.reduce((sum: number, row: any) => sum + Number(row.amount), 0),
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
        amount: Number(ex.transaction.amount),
        amountInToman: Number(ex.transaction.amountInToman),
        rateSnapshot: Number(ex.transaction.rateSnapshot),
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
