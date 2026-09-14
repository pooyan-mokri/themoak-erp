'use server';

/**
 * Sales Actions - فروش و سفارشات
 * - ایجاد سفارش
 * - مدیریت پرداخت‌ها
 * - لغو سفارشات
 * - دریافت لیست سفارشات
 */

import { TransactionType } from '@/lib/types';
import { PrismaClient, Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';

import { prisma } from '@/lib/prisma';
import { restoreOrderItemStock } from '@/lib/restore-warehouse';
import { balanceEffect } from '@/lib/balance-reconciliation';
import { WEBSITE_ORDER_LOCKED, readSiteOrderData } from '@/lib/site-sale-data';
import { kickSiteHook } from '@/lib/site-hook';

// const prisma = new PrismaClient();



interface CartItem {
  productId: string;
  quantity: number;
  price: number;
}

interface OrderData {
  customerId: string;
  items: CartItem[];
  paymentMethod: 'CASH' | 'ACCOUNT';
  accountId: string; // Cash Box or Bank Account ID
  totalAmount: number;
  discount?: number;
  paidAmount?: number;
  warehouseId?: string; // Which warehouse to deduct stock from
  saleDate?: string; // ISO date string for the sale; defaults to now
  tags?: string[];
  invoiceAccountId?: string; // Account whose card/IBAN to show on credit invoice
}

export async function createOrder(data: OrderData) {
  const { customerId, items, paymentMethod, accountId, totalAmount, discount = 0, paidAmount, warehouseId, saleDate, tags = [], invoiceAccountId } = data;
  const orderDate = saleDate ? new Date(saleDate) : new Date();

  if (!items.length) {
    return { success: false, message: 'سبد خرید خالی است.' };
  }

  // Calculate final amounts
  const finalPaidAmount = paidAmount !== undefined ? paidAmount : (totalAmount - discount);
  const debtAmount = (totalAmount - discount) - finalPaidAmount;

  try {
    await prisma.$transaction(async (tx: any) => {
      let transactionId = undefined;

      // 1. Fetch customer first to get name for transaction description
      let customer = undefined;
      if (customerId) {
        customer = await tx.customer.findUnique({
          where: { id: customerId },
          include: {
            warehouses: {
              where: { isVirtual: true },
            },
          },
        });
      }

      // 2. Create Transaction (Income) ONLY if there is a payment
      if (finalPaidAmount > 0) {
        const customerName = customer?.name || 'مشتری عمومی';

        // POS prices are in TOMAN — convert to the account's currency
        // when the cashier collects to a foreign-currency account.
        const account = await tx.account.findUnique({ where: { id: accountId } });
        if (!account) {
          throw new Error('حساب دریافت وجه یافت نشد.');
        }
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
        const amountInAccountCurrency = finalPaidAmount / rate;

        const transaction = await tx.transaction.create({
          data: {
            amount: new Prisma.Decimal(amountInAccountCurrency),
            currency: account.currency,
            rateSnapshot: new Prisma.Decimal(rate),
            amountInToman: new Prisma.Decimal(finalPaidAmount),
            type: TransactionType.INCOME,
            accountId: accountId,
            customerId: customerId || undefined,
            description: `سفارش فروش - مشتری: ${customerName}`,
            category: 'Sales',
            date: orderDate,
          },
        });
        transactionId = transaction.id;

        // 3. Update Account Balance in the account's own currency
        await tx.account.update({
          where: { id: accountId },
          data: {
            balance: { increment: new Prisma.Decimal(amountInAccountCurrency) },
          },
        });
      }

      // 4. Resolve which warehouse each item is deducted from BEFORE creating
      // OrderItems so we can persist warehouseId per item.
      const itemWarehouses: string[] = [];
      for (const item of items) {
        if (warehouseId) {
          itemWarehouses.push(warehouseId);
        } else {
          const inv = await tx.inventory.findFirst({
            where: { productId: item.productId, quantity: { gte: item.quantity } },
          });
          if (!inv) {
            const product = await tx.product.findUnique({ where: { id: item.productId }, select: { name: true } });
            throw new Error(`موجودی کافی برای محصول "${product?.name || item.productId}" وجود ندارد.`);
          }
          itemWarehouses.push(inv.warehouseId);
        }
      }

      // 5. Create Order
      const order = await tx.order.create({
        data: {
          customerId,
          totalAmount,
          discount,
          paidAmount: finalPaidAmount,
          paymentStatus: debtAmount > 0 ? (finalPaidAmount > 0 ? 'PARTIAL' : 'UNPAID') : 'PAID',
          status: 'COMPLETED',
          transactionId: transactionId,
          createdAt: orderDate,
          tags,
          invoiceAccountId: invoiceAccountId ?? null,
          items: {
            create: items.map((item: any, idx: number) => ({
              productId: item.productId,
              quantity: item.quantity,
              price: item.price,
              warehouseId: itemWarehouses[idx],
            })),
          },
        },
      });

      // 5. Calculate and record commission if customer is a consignment partner
      if (customer && customer.commissionRate && customer.warehouses.length > 0) {
        const commissionRate = Number(customer.commissionRate);
        const orderAmount = Number(totalAmount) - Number(discount);
        const commissionAmount = (orderAmount * commissionRate) / 100;

        if (commissionAmount > 0) {
          await tx.consignmentCommission.create({
            data: {
              customerId: customer.id,
              orderId: order.id,
              commissionRate: new Prisma.Decimal(commissionRate),
              orderAmount: new Prisma.Decimal(orderAmount),
              commissionAmount: new Prisma.Decimal(commissionAmount),
              isPaid: false,
            },
          });
        }
      }

      // 7. Deduct inventory from the resolved warehouse for each item.
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const whId = itemWarehouses[i];
        const inventory = await tx.inventory.findUnique({
          where: {
            productId_warehouseId: { productId: item.productId, warehouseId: whId },
          },
        });

        if (!inventory || inventory.quantity < item.quantity) {
          const product = await tx.product.findUnique({ where: { id: item.productId }, select: { name: true } });
          throw new Error(`موجودی کافی برای محصول "${product?.name || item.productId}" در انبار انتخابی وجود ندارد.`);
        }

        await tx.inventory.update({
          where: {
            productId_warehouseId: { productId: item.productId, warehouseId: whId },
          },
          data: {
            quantity: { decrement: item.quantity },
          },
        });
      }
    });
    kickSiteHook();

    try {
      revalidatePath('/dashboard/sales');
      revalidatePath('/dashboard/inventory');
    } catch (error) {
      // Ignore revalidatePath error outside of Next.js context
    }
    return { success: true, message: 'سفارش با موفقیت ثبت شد.' };

  } catch (error: any) {
    console.error(error);
    return { success: false, message: error.message || 'خطا در ثبت سفارش.' };
  }
}

export async function getOrders() {
  try {
    const orders = await prisma.order.findMany({
      include: {
        customer: true,
        items: {
          include: {
            product: true,
            warehouse: { select: { id: true, name: true } },
          },
        },
        siteRefunds: { select: { refundId: true, amount: true, at: true }, orderBy: { at: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map((order: any) => ({
      ...order,
      customerId: order.customerId ?? undefined,
      transactionId: order.transactionId ?? undefined,
      wooId: order.wooId ?? undefined,
      invoiceId: order.invoiceId ?? undefined,
      totalAmount: Number(order.totalAmount),
      discount: Number(order.discount),
      paidAmount: Number(order.paidAmount),
      siteReference: order.siteReference ?? undefined,
      siteData: readSiteOrderData(order.siteData) ?? undefined,
      siteRefunds: order.siteRefunds.map((refund: any) => ({
        refundId: refund.refundId,
        amount: Number(refund.amount),
        at: refund.at,
      })),
      customer: order.customer ? {
        ...order.customer,
        phone: order.customer.phone ?? undefined,
        email: order.customer.email ?? undefined,
        address: order.customer.address ?? undefined,
        wooId: order.customer.wooId ?? undefined,
        notes: order.customer.notes ?? undefined,
        creditLimit: Number(order.customer.creditLimit),
        segment: order.customer.segment ?? undefined,
        taxId: order.customer.taxId ?? undefined,
        commissionRate: order.customer.commissionRate ? Number(order.customer.commissionRate) : undefined,
        type: order.customer.customerType,
      } : undefined,
      items: order.items.map((item: any) => ({
        ...item,
        price: Number(item.price),
        product: item.product ? {
          ...item.product,
          costPrice: Number(item.product.costPrice),
          sellPrice: Number(item.product.sellPrice),
          image: item.product.image ?? undefined,
          wooId: item.product.wooId ?? undefined,
          barcode: item.product.barcode ?? undefined,
        } : undefined,
      })),
    }));
  } catch (error) {
    console.error('Error fetching orders:', error);
    return [];
  }
}

// Record payment for an unpaid or partially paid order
export async function recordOrderPayment(orderId: string, accountId: string, amount: number) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true },
    });

    if (!order) {
      return { success: false, message: 'سفارش یافت نشد.' };
    }

    const currentPaid = Number(order.paidAmount);
    const totalAmount = Number(order.totalAmount) - Number(order.discount);
    const remainingDebt = totalAmount - currentPaid;

    if (amount <= 0) {
      return { success: false, message: 'مبلغ پرداخت باید بیشتر از صفر باشد.' };
    }

    if (amount > remainingDebt) {
      return { success: false, message: `مبلغ پرداخت نمی‌تواند بیشتر از بدهی باقیمانده (${remainingDebt.toLocaleString()} تومان) باشد.` };
    }

    await prisma.$transaction(async (tx: any) => {
      // 1. Create Income Transaction
      const customerName = order.customer?.name || 'مشتری';
      const transaction = await tx.transaction.create({
        data: {
          amount,
          currency: 'TOMAN',
          rateSnapshot: 1,
          amountInToman: amount,
          type: TransactionType.INCOME,
          accountId,
          description: `دریافت بابت سفارش #${order.number} - مشتری: ${customerName}`,
          category: 'Sales',
          date: new Date(),
        },
      });

      // 2. Update Account Balance
      await tx.account.update({
        where: { id: accountId },
        data: {
          balance: {
            increment: amount,
          },
        },
      });

      // 3. Update Order Payment Status
      const newPaidAmount = currentPaid + amount;
      const newPaymentStatus = newPaidAmount >= totalAmount ? 'PAID' : 'PARTIAL';

      await tx.order.update({
        where: { id: orderId },
        data: {
          paidAmount: newPaidAmount,
          paymentStatus: newPaymentStatus,
        },
      });
    });

    // If order is now fully paid and came from WooCommerce, mark it as completed
    if (order.wooId) {
      const finalPaidAmount = currentPaid + amount;
      if (finalPaidAmount >= totalAmount) {
        try {
          const { completeOrderInWooCommerce } = await import('./woocommerce');
          const result = await completeOrderInWooCommerce(order.wooId);
          if (result.success) {
            console.log(`[Payment] سفارش WooCommerce #${order.number} (ID: ${order.wooId}) در WooCommerce به تکمیل شده تغییر کرد.`);
          } else {
            console.warn(`[Payment] خطا در تکمیل سفارش در WooCommerce: ${result.message}`);
          }
        } catch (error) {
          console.error('[Payment] خطا در تکمیل سفارش در WooCommerce:', error);
          // Don't fail the payment process if WooCommerce update fails
        }
      }
    }

    revalidatePath('/dashboard/sales/history');
    revalidatePath(`/dashboard/sales/history/${orderId}`);
    return { success: true, message: 'پرداخت با موفقیت ثبت شد.' };
  } catch (error: any) {
    console.error('Error recording payment:', error);
    return { success: false, message: error.message || 'خطا در ثبت پرداخت.' };
  }
}

export async function getOrder(id: string) {
  try {
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        customer: {
          include: {
            warehouses: { where: { isVirtual: true } },
          },
        },
        items: {
          include: {
            product: true,
            warehouse: true,
            exchangeItems: { select: { id: true } },
            returns: { select: { quantity: true } },
            exchanges: { select: { quantity: true } },
          },
        },
        transaction: {
            include: {
                account: true
            }
        },
        invoice: true,
        commissions: true,
        siteRefunds: { select: { refundId: true, amount: true, at: true }, orderBy: { at: 'asc' } },
      },
    });
    if (!order) return undefined;
    return {
      ...order,
      customerId: order.customerId ?? undefined,
      transactionId: order.transactionId ?? undefined,
      wooId: order.wooId ?? undefined,
      invoiceId: order.invoiceId ?? undefined,
      totalAmount: Number(order.totalAmount),
      discount: Number(order.discount),
      paidAmount: Number(order.paidAmount),
      siteReference: order.siteReference ?? undefined,
      siteData: readSiteOrderData(order.siteData) ?? undefined,
      siteRefunds: order.siteRefunds.map((refund: any) => ({
        refundId: refund.refundId,
        amount: Number(refund.amount),
        at: refund.at,
      })),
      customer: order.customer ? {
        ...order.customer,
        phone: order.customer.phone ?? undefined,
        email: order.customer.email ?? undefined,
        address: order.customer.address ?? undefined,
        wooId: order.customer.wooId ?? undefined,
        notes: order.customer.notes ?? undefined,
        creditLimit: Number(order.customer.creditLimit),
        segment: order.customer.segment ?? undefined,
        taxId: order.customer.taxId ?? undefined,
        commissionRate: order.customer.commissionRate ? Number(order.customer.commissionRate) : undefined,
        type: order.customer.customerType,
      } : undefined,
      isConsignmentSale: !!(order.commissions && order.commissions.length > 0)
        || !!(order.customer && (order.customer as any).warehouses && (order.customer as any).warehouses.length > 0),
      commissions: order.commissions
        ? order.commissions.map((c: any) => ({
            ...c,
            commissionRate: Number(c.commissionRate),
            orderAmount: Number(c.orderAmount),
            commissionAmount: Number(c.commissionAmount),
          }))
        : [],
      items: order.items.map((item: any) => {
        const returnedQty = (item.returns || []).reduce(
          (s: number, r: any) => s + (r.quantity || 0), 0
        );
        const exchangedQty = (item.exchanges || []).reduce(
          (s: number, e: any) => s + (e.quantity || 0), 0
        );
        const remainingQuantity = Math.max(0, item.quantity - returnedQty - exchangedQty);
        return {
          ...item,
          price: Number(item.price),
          warehouseId: item.warehouseId ?? undefined,
          warehouse: item.warehouse
            ? { id: item.warehouse.id, name: item.warehouse.name, isVirtual: item.warehouse.isVirtual }
            : undefined,
          isExchangeDerived: !!(item.exchangeItems && item.exchangeItems.length > 0),
          remainingQuantity,
          returnedQuantity: returnedQty,
          exchangedQuantity: exchangedQty,
          // Strip the raw relations we only used for aggregation
          returns: undefined,
          exchanges: undefined,
          exchangeItems: undefined,
          product: item.product ? {
            ...item.product,
            costPrice: Number(item.product.costPrice),
            sellPrice: Number(item.product.sellPrice),
            image: item.product.image ?? undefined,
            wooId: item.product.wooId ?? undefined,
            barcode: item.product.barcode ?? undefined,
          } : undefined,
        };
      }),
      transaction: order.transaction ? {
        ...order.transaction,
        amount: Number(order.transaction.amount),
        amountInToman: Number(order.transaction.amountInToman),
        rateSnapshot: Number(order.transaction.rateSnapshot),
        accountId: order.transaction.accountId ?? undefined,
        projectId: order.transaction.projectId ?? undefined,
        description: order.transaction.description ?? undefined,
        category: order.transaction.category ?? undefined,
        wooId: order.transaction.wooId ?? undefined,
        wooStatus: order.transaction.wooStatus ?? undefined,
        receiptUrl: order.transaction.receiptUrl ?? undefined,
        shareholderId: order.transaction.shareholderId ?? undefined,
        employeeId: order.transaction.employeeId ?? undefined,
        account: order.transaction.account ? {
          ...order.transaction.account,
          balance: Number(order.transaction.account.balance),
        } : undefined,
      } : undefined,
      invoice: order.invoice ? {
        ...order.invoice,
        subtotal: Number(order.invoice.subtotal),
        discount: Number(order.invoice.discount),
        tax: Number(order.invoice.tax),
        total: Number(order.invoice.total),
        paidAmount: Number(order.invoice.paidAmount),
        notes: order.invoice.notes ?? undefined,
      } : undefined,
    };
  } catch (error) {
    console.error('Error fetching order:', error);
    return undefined;
  }
}

/**
 * لغو (حذف) سفارش
 * - اگر از WooCommerce باشد، در WooCommerce هم لغو می‌شود
 * - اگر transaction داشته باشد، transaction حذف می‌شود
 * - موجودی حساب بازگردانده می‌شود
 */
export async function cancelOrder(orderId: string): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    // Get order with all relations
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        transaction: {
          include: {
            account: true,
          },
        },
        items: {
          include: {
            product: true,
            warehouse: true,
          },
        },
        invoice: true,
      },
    });

    if (!order) {
      return { success: false, message: 'سفارش یافت نشد.' };
    }

    // Website orders are reversed on the website (setSaleStatus); cancelling
    // them here too would move their money and stock a second time.
    if (order.siteReference !== null) {
      return { success: false, message: WEBSITE_ORDER_LOCKED };
    }

    // Check if already cancelled
    if (order.status === 'CANCELLED') {
      return { success: false, message: 'این سفارش قبلاً لغو شده است.' };
    }

    // Lines deliberately not credited back (e.g. a WooCommerce order whose
    // stock was never deducted). Reported to the operator rather than hidden
    // behind a blanket success message.
    const notRestored: string[] = [];

    await prisma.$transaction(async (tx) => {
      // 1. Claim the cancellation. The status check above runs outside this
      // transaction, so two concurrent cancels could both pass it and restore
      // the stock twice. This conditional update serializes them in the DB.
      // It never claims a website order, for the same reason as the check above.
      const claimed = await tx.order.updateMany({
        where: { id: orderId, status: { not: 'CANCELLED' }, siteReference: null },
        data: {
          status: 'CANCELLED',
          paymentStatus: 'UNPAID',
          paidAmount: 0,
          transactionId: null,
        },
      });
      if (claimed.count === 0) {
        throw new Error('این سفارش هم‌زمان توسط کاربر دیگری لغو شد.');
      }

      // 2. Restore inventory. Never skip a line silently: resolve the target
      // warehouse through a validated fallback (the column is nullable and is
      // blanked when a warehouse is deleted), net out quantities already
      // credited back by returns/exchanges, and report anything intentionally
      // left uncredited instead of swallowing it.
      for (const item of order.items) {
        const note = await restoreOrderItemStock(
          tx,
          order as any,
          item as any,
          (item as any).product?.name ?? item.productId,
          order.number,
        );
        if (note) notRestored.push(note);
      }

      // 3. If order had a transaction, restore account balance and delete it
      if (order.transactionId && order.transaction) {
        const transaction = order.transaction;

        // Undo exactly what this row did to the balance. createOrder credits
        // the account in ITS OWN currency (amountInAccountCurrency), so
        // reversing with amountInToman would credit a Toman figure back to a
        // foreign-currency account. balanceEffect replays the same rule the
        // reconciliation report uses, so the two can never disagree.
        const balanceChange = -balanceEffect(transaction as any);

        if (transaction.accountId) {
          await tx.account.update({
            where: { id: transaction.accountId },
            data: { balance: { increment: balanceChange } },
          });
        }

        // Delete transaction (order no longer references it)
        await tx.transaction.delete({ where: { id: transaction.id } });
      }

      // 4. Cancel the linked invoice (if any)
      if (order.invoice) {
        await tx.invoice.update({
          where: { id: order.invoice.id },
          data: { status: 'CANCELLED' },
        });
      }

      // 5. Mark order items as CANCELLED
      await tx.orderItem.updateMany({
        where: { orderId },
        data: { status: 'CANCELLED' },
      });
    });
    kickSiteHook();

    // 3. If order is from WooCommerce, cancel it there too
    if (order.wooId) {
      try {
        const { cancelOrderInWooCommerce } = await import('./woocommerce');
        await cancelOrderInWooCommerce(order.wooId);
        console.log(`[CANCEL-ORDER] سفارش WooCommerce #${order.wooId} لغو شد`);
      } catch (wooError) {
        console.error('[CANCEL-ORDER] خطا در لغو سفارش در WooCommerce:', wooError);
        // Don't fail the whole operation if WooCommerce update fails
      }
    }

    // Revalidate relevant paths to update the UI
    revalidatePath('/dashboard/sales/history');
    revalidatePath('/dashboard/sales');
    revalidatePath('/dashboard/reports/ar-aging');

    return {
      success: true,
      message: notRestored.length > 0
        ? `سفارش #${order.number} لغو شد، اما موجودی این اقلام بازنگشت: ${notRestored.join(' ')}`
        : `سفارش #${order.number} با موفقیت لغو شد و موجودی کالاها به انبار بازگشت.`,
    };
  } catch (error) {
    console.error('Error cancelling order:', error);
    // Surface the real reason (e.g. target warehouse could not be determined)
    // so the operator can fix it, instead of a blanket failure message.
    return {
      success: false,
      message: error instanceof Error ? error.message : 'خطا در لغو سفارش.',
    };
  }
}
