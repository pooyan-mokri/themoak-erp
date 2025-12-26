'use server';

import { PrismaClient } from '@prisma/client';
import { revalidatePath } from 'next/cache';

import { prisma } from '@/lib/prisma';

// const prisma = new PrismaClient();

// Generate unique invoice number in format: INV-{YEAR}-{SEQUENTIAL}
async function generateInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  
  // Get the last invoice for this year
  const lastInvoice = await prisma.invoice.findFirst({
    where: {
      invoiceNumber: {
        startsWith: prefix
      }
    },
    orderBy: {
      invoiceNumber: 'desc'
    }
  });

  let nextNumber = 1;
  if (lastInvoice) {
    const lastNumber = parseInt(lastInvoice.invoiceNumber.split('-')[2]);
    nextNumber = lastNumber + 1;
  }

  return `${prefix}${String(nextNumber).padStart(5, '0')}`;
}

export async function createInvoiceFromOrder(orderId: string) {
  try {
    // Check if invoice already exists
    const existingInvoice = await prisma.invoice.findUnique({
      where: { orderId }
    });

    if (existingInvoice) {
      return { success: false, message: 'این سفارش قبلاً فاکتور شده است.' };
    }

    // Get order details
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
      }
    });

    if (!order) {
      return { success: false, message: 'سفارش یافت نشد.' };
    }

    if (!order.customerId) {
      return { success: false, message: 'این سفارش مشتری ندارد.' };
    }

    // Get customer payment terms
    const customer = order.customer;
    const paymentTerms = customer?.paymentTerms || 30;

    // Calculate dates
    const issueDate = new Date();
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + paymentTerms);

    // Calculate amounts
    const subtotal = Number(order.totalAmount);
    const discount = Number(order.discount);
    const tax = 0; // TODO: Implement tax calculation
    const total = subtotal - discount + tax;
    const paidAmount = Number(order.paidAmount);

    // Determine status
    let status = 'PAID';
    if (paidAmount < total) {
      if (paidAmount > 0) {
        status = 'PARTIAL';
      } else {
        status = 'UNPAID';
      }
    }

    // Check if overdue
    if (status !== 'PAID' && dueDate < new Date()) {
      status = 'OVERDUE';
    }

    // Generate invoice number
    const invoiceNumber = await generateInvoiceNumber();

    // Create invoice
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        orderId,
        customerId: order.customerId,
        issueDate,
        dueDate,
        subtotal,
        discount,
        tax,
        total,
        paidAmount,
        status,
      }
    });

    // Update order
    await prisma.order.update({
      where: { id: orderId },
      data: {
        invoiceId: invoice.id,
        status: 'INVOICED',
      }
    });

    revalidatePath('/dashboard/sales/invoices');
    revalidatePath(`/dashboard/sales/history/${orderId}`);
    return { success: true, message: 'فاکتور با موفقیت ایجاد شد.', invoiceId: invoice.id };
  } catch (error) {
    console.error('Error creating invoice:', error);
    return { success: false, message: 'خطا در ایجاد فاکتور.' };
  }
}

export async function getInvoices() {
  try {
    const invoices = await prisma.invoice.findMany({
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          }
        },
        order: {
          select: {
            id: true,
            number: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' },
    });
    return invoices.map(invoice => ({
      ...invoice,
      subtotal: Number(invoice.subtotal),
      discount: invoice.discount ? Number(invoice.discount) : undefined,
      tax: invoice.tax ? Number(invoice.tax) : undefined,
      total: Number(invoice.total),
      paidAmount: invoice.paidAmount ? Number(invoice.paidAmount) : undefined,
    }));
  } catch (error) {
    console.error('Error fetching invoices:', error);
    return [];
  }
}

export async function getInvoiceById(id: string) {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        customer: true,
        order: {
          include: {
            items: {
              include: { product: true }
            },
            transaction: {
              include: { account: true }
            }
          }
        }
      }
    });
    if (!invoice) return undefined;
    return {
      ...invoice,
      subtotal: Number(invoice.subtotal),
      discount: invoice.discount ? Number(invoice.discount) : undefined,
      tax: invoice.tax ? Number(invoice.tax) : undefined,
      total: Number(invoice.total),
      paidAmount: invoice.paidAmount ? Number(invoice.paidAmount) : undefined,
      order: invoice.order ? {
        ...invoice.order,
        totalAmount: Number(invoice.order.totalAmount),
        discount: invoice.order.discount ? Number(invoice.order.discount) : undefined,
        paidAmount: invoice.order.paidAmount ? Number(invoice.order.paidAmount) : undefined,
        items: invoice.order.items.map(item => ({
          ...item,
          price: Number(item.price),
        })),
        transaction: invoice.order.transaction ? {
          ...invoice.order.transaction,
          amount: Number(invoice.order.transaction.amount),
          amountInToman: Number(invoice.order.transaction.amountInToman),
          rateSnapshot: Number(invoice.order.transaction.rateSnapshot),
          account: invoice.order.transaction.account ? {
            ...invoice.order.transaction.account,
            balance: Number(invoice.order.transaction.account.balance),
          } : undefined,
        } : undefined,
      } : undefined,
    };
  } catch (error) {
    console.error('Error fetching invoice:', error);
    return undefined;
  }
}

export async function recordInvoicePayment(invoiceId: string, amount: number, accountId: string) {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { order: true }
    });

    if (!invoice) {
      return { success: false, message: 'فاکتور یافت نشد.' };
    }

    const newPaidAmount = Number(invoice.paidAmount) + amount;
    const total = Number(invoice.total);

    // Determine new status
    let newStatus = 'PAID';
    if (newPaidAmount < total) {
      newStatus = newPaidAmount > 0 ? 'PARTIAL' : 'UNPAID';
    }

    // Update invoice
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        paidAmount: newPaidAmount,
        status: newStatus,
      }
    });

    // Update order
    if (invoice.orderId) {
      const orderNewPaidAmount = Number(invoice.order.paidAmount) + amount;
      const orderTotal = Number(invoice.order.totalAmount) - Number(invoice.order.discount);
      let orderPaymentStatus = 'PAID';
      if (orderNewPaidAmount < orderTotal) {
        orderPaymentStatus = orderNewPaidAmount > 0 ? 'PARTIAL' : 'UNPAID';
      }

      await prisma.order.update({
        where: { id: invoice.orderId },
        data: {
          paidAmount: orderNewPaidAmount,
          paymentStatus: orderPaymentStatus,
        }
      });
    }

    // Create transaction for the payment
    await prisma.transaction.create({
      data: {
        accountId,
        type: 'INCOME',
        amount,
        currency: 'TOMAN',
        rateSnapshot: 1,
        amountInToman: amount,
        description: `پرداخت فاکتور ${invoice.invoiceNumber}`,
        category: 'Sales',
        date: new Date(),
      }
    });

    // Update account balance
    await prisma.account.update({
      where: { id: accountId },
      data: {
        balance: {
          increment: amount
        }
      }
    });

    revalidatePath('/dashboard/sales/invoices');
    revalidatePath(`/dashboard/sales/invoices/${invoiceId}`);
    return { success: true, message: 'پرداخت ثبت شد.' };
  } catch (error) {
    console.error('Error recording payment:', error);
    return { success: false, message: 'خطا در ثبت پرداخت.' };
  }
}

export async function getARAgingReport() {
  try {
    const invoices = await prisma.invoice.findMany({
      where: {
        status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] }
      },
      include: {
        customer: true
      }
    });

    const today = new Date();
    
    // Group by customer and calculate buckets
    const customerBuckets: Record<string, any> = {};

    for (const invoice of invoices) {
      const customerId = invoice.customerId;
      const balance = Number(invoice.total) - Number(invoice.paidAmount);
      const daysPastDue = Math.floor((today.getTime() - invoice.dueDate.getTime()) / (1000 * 60 * 60 * 24));

      if (!customerBuckets[customerId]) {
        customerBuckets[customerId] = {
          customerName: invoice.customer.name,
          totalDue: 0,
          current: 0,
          days1_30: 0,
          days31_60: 0,
          days61_90: 0,
          days90Plus: 0,
        };
      }

      customerBuckets[customerId].totalDue += balance;

      if (daysPastDue <= 0) {
        customerBuckets[customerId].current += balance;
      } else if (daysPastDue <= 30) {
        customerBuckets[customerId].days1_30 += balance;
      } else if (daysPastDue <= 60) {
        customerBuckets[customerId].days31_60 += balance;
      } else if (daysPastDue <= 90) {
        customerBuckets[customerId].days61_90 += balance;
      } else {
        customerBuckets[customerId].days90Plus += balance;
      }
    }

    return Object.values(customerBuckets);
  } catch (error) {
    console.error('Error generating AR aging report:', error);
    return [];
  }
}

export async function updateInvoiceStatus() {
  try {
    // Update overdue invoices
    const overdueInvoices = await prisma.invoice.findMany({
      where: {
        status: { in: ['UNPAID', 'PARTIAL'] },
        dueDate: {
          lt: new Date()
        }
      }
    });

    for (const invoice of overdueInvoices) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'OVERDUE' }
      });
    }

    return { success: true, message: `${overdueInvoices.length} فاکتور به‌روز شد.` };
  } catch (error) {
    console.error('Error updating invoice status:', error);
    return { success: false, message: 'خطا در به‌روزرسانی وضعیت فاکتورها.' };
  }
}
