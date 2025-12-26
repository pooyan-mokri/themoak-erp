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
      let transactionId = null;

      // 1. Fetch customer first to get name for transaction description
      let customer = null;
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
            create: items.map((item) => ({
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
      totalAmount: Number(order.totalAmount),
      discount: order.discount ? Number(order.discount) : undefined,
      paidAmount: order.paidAmount ? Number(order.paidAmount) : undefined,
      items: order.items.map(item => ({
        ...item,
        price: Number(item.price),
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
    if (!order) return null;
    return {
      ...order,
      totalAmount: Number(order.totalAmount),
      discount: order.discount ? Number(order.discount) : undefined,
      paidAmount: order.paidAmount ? Number(order.paidAmount) : undefined,
      items: order.items.map(item => ({
        ...item,
        price: Number(item.price),
      })),
      transaction: order.transaction ? {
        ...order.transaction,
        amount: Number(order.transaction.amount),
        amountInToman: Number(order.transaction.amountInToman),
        rateSnapshot: Number(order.transaction.rateSnapshot),
        account: order.transaction.account ? {
          ...order.transaction.account,
          balance: Number(order.transaction.account.balance),
        } : null,
      } : null,
    };
  } catch (error) {
    console.error('Error fetching order:', error);
    return null;
  }
}
