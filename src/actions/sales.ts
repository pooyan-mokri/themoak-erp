'use server';

import { TransactionType } from '@/lib/types';
import { PrismaClient, Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';

import { prisma } from '@/lib/prisma';

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
}

export async function createOrder(data: OrderData) {
  const { customerId, items, paymentMethod, accountId, totalAmount, discount = 0, paidAmount } = data;

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
        const transaction = await tx.transaction.create({
          data: {
            amount: finalPaidAmount,
            currency: 'TOMAN', // Assuming POS is Toman for now
            rateSnapshot: 1,
            amountInToman: finalPaidAmount,
            type: TransactionType.INCOME,
            accountId: accountId,
            description: `سفارش فروش - مشتری: ${customerName}`,
            category: 'Sales',
            date: new Date(),
          },
        });
        transactionId = transaction.id;

        // 3. Update Account Balance
        await tx.account.update({
          where: { id: accountId },
          data: {
            balance: {
              increment: finalPaidAmount,
            },
          },
        });
      }

      // 4. Create Order
      const order = await tx.order.create({
        data: {
          customerId,
          totalAmount,
          discount,
          paidAmount: finalPaidAmount,
          paymentStatus: debtAmount > 0 ? (finalPaidAmount > 0 ? 'PARTIAL' : 'UNPAID') : 'PAID',
          status: 'COMPLETED',
          transactionId: transactionId,
          items: {
            create: items.map((item: any) => ({
              productId: item.productId,
              quantity: item.quantity,
              price: item.price,
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

      // 6. Deduct Inventory
      for (const item of items) {
        // Find inventory
        const inventory = await tx.inventory.findFirst({
            where: { productId: item.productId, quantity: { gte: item.quantity } }
        });

        if (!inventory) {
            throw new Error(`موجودی کافی برای محصول ${item.productId} وجود ندارد.`);
        }

        await tx.inventory.update({
            where: {
                productId_warehouseId: {
                    productId: item.productId,
                    warehouseId: inventory.warehouseId
                }
            },
            data: {
                quantity: { decrement: item.quantity }
            }
        });
      }
    });

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
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map(order => ({
      ...order,
      customerId: order.customerId ?? undefined,
      transactionId: order.transactionId ?? undefined,
      wooId: order.wooId ?? undefined,
      invoiceId: order.invoiceId ?? undefined,
      totalAmount: Number(order.totalAmount),
      discount: Number(order.discount),
      paidAmount: Number(order.paidAmount),
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
      } : undefined,
      items: order.items.map(item => ({
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

export async function getOrder(id: string) {
  try {
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        customer: true,
        items: {
          include: {
            product: true,
          },
        },
        transaction: {
            include: {
                account: true
            }
        },
        invoice: true,
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
      } : undefined,
      items: order.items.map(item => ({
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
