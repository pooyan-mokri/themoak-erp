'use server';

import { PrismaClient } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { prisma } from '@/lib/prisma';

// const prisma = new PrismaClient();

const CustomerSchema = z.object({
  name: z.string().min(1, 'نام مشتری الزامی است'),
  phone: z.string().optional(),
  email: z.string().email('ایمیل نامعتبر است').optional().or(z.literal('')),
  address: z.string().optional(),
});

export async function createCustomer(prevState: any, formData: FormData) {
  const validatedFields = CustomerSchema.safeParse({
    name: formData.get('name')?.toString() || '',
    phone: formData.get('phone')?.toString() || undefined,
    email: formData.get('email')?.toString() || undefined,
    address: formData.get('address')?.toString() || undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, phone, email, address } = validatedFields.data;

  try {
    const customer = await prisma.customer.create({
      data: {
        name,
        phone,
        email: email || null,
        address,
      },
    });
    
    revalidatePath('/dashboard/sales/customers');
    revalidatePath('/dashboard/crm/customers');
    return { 
      message: 'مشتری با موفقیت ثبت شد.', 
      success: true,
      customerId: customer.id,
      customer: { id: customer.id, name: customer.name }
    };
  } catch (error) {
    return {
      message: 'خطا در ثبت مشتری.',
    };
  }
}

export async function updateCustomer(id: string, prevState: any, formData: FormData) {
  const validatedFields = CustomerSchema.safeParse({
    name: formData.get('name')?.toString() || '',
    phone: formData.get('phone')?.toString() || undefined,
    email: formData.get('email')?.toString() || undefined,
    address: formData.get('address')?.toString() || undefined,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'لطفا فیلدهای الزامی را پر کنید.',
    };
  }

  const { name, phone, email, address} = validatedFields.data;

  try {
    await prisma.customer.update({
      where: { id },
      data: {
        name,
        phone,
        email: email || null,
        address,
      },
    });
  } catch (error) {
    return {
      message: 'خطا در ویرایش مشتری.',
    };
  }

  revalidatePath('/dashboard/sales/customers');
  revalidatePath('/dashboard/crm/customers');
  revalidatePath(`/dashboard/crm/customers/${id}`);
  return { message: 'مشتری با موفقیت ویرایش شد.', success: true };
}

export async function deleteCustomer(id: string) {
  try {
    // Check for orders
    const orderCount = await prisma.order.count({
      where: { customerId: id },
    });

    if (orderCount > 0) {
      return { success: false, message: 'این مشتری دارای سفارش است و قابل حذف نیست.' };
    }

    await prisma.customer.delete({
      where: { id },
    });

    revalidatePath('/dashboard/sales/customers');
    revalidatePath('/dashboard/crm/customers');
    return { success: true, message: 'مشتری با موفقیت حذف شد.' };
  } catch (error) {
    console.error('Error deleting customer:', error);
    return { success: false, message: 'خطا در حذف مشتری.' };
  }
}

export async function getCustomers() {
  try {
    const customers = await prisma.customer.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return customers.map(customer => ({
      ...customer,
      creditLimit: customer.creditLimit ? Number(customer.creditLimit) : undefined,
      commissionRate: customer.commissionRate ? Number(customer.commissionRate) : undefined,
    }));
  } catch (error) {
    throw new Error('Failed to fetch customers');
  }
}

export async function getCustomer(id: string) {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        orders: {
            orderBy: { createdAt: 'desc' },
            include: {
              customer: true,
              items: { include: { product: true } }
            }
        }
      }
    });
    if (!customer) return null;
    return {
      ...customer,
      creditLimit: customer.creditLimit ? Number(customer.creditLimit) : undefined,
      commissionRate: customer.commissionRate ? Number(customer.commissionRate) : undefined,
      orders: customer.orders.map(order => ({
        ...order,
        totalAmount: Number(order.totalAmount),
        discount: order.discount ? Number(order.discount) : undefined,
        paidAmount: order.paidAmount ? Number(order.paidAmount) : undefined,
        customer: order.customer ? {
          ...order.customer,
          creditLimit: order.customer.creditLimit ? Number(order.customer.creditLimit) : undefined,
          commissionRate: order.customer.commissionRate ? Number(order.customer.commissionRate) : undefined,
        } : null,
        items: order.items.map(item => ({
          ...item,
          price: Number(item.price),
        })),
      })),
    };
  } catch (error) {
    return null;
  }
}

export async function updateCustomerNotes(id: string, notes: string) {
  try {
    await prisma.customer.update({
      where: { id },
      data: { notes },
    });
    try {
      revalidatePath(`/dashboard/sales/customers/${id}`);
      revalidatePath(`/dashboard/crm/customers/${id}`);
    } catch (error) {
      // Ignore revalidatePath error outside of Next.js context
    }
    return { success: true, message: 'یادداشت‌ها بروزرسانی شد.' };
  } catch (error) {
    return { success: false, message: 'خطا در بروزرسانی یادداشت‌ها.' };
  }
}

// CRM Enhancement Functions

export async function getCustomersWithDebt() {
  try {
    const customers = await prisma.customer.findMany({
      include: {
        orders: {
          where: {
            paymentStatus: { in: ['PARTIAL', 'UNPAID'] }
          },
          select: {
            totalAmount: true,
            discount: true,
            paidAmount: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    // Calculate debt for each customer
    return customers.map(customer => {
      const totalDebt = customer.orders.reduce((sum, order) => {
        const orderTotal = Number(order.totalAmount) - Number(order.discount);
        const debt = orderTotal - Number(order.paidAmount);
        return sum + debt;
      }, 0);

      return {
        ...customer,
        totalDebt,
      };
    });
  } catch (error) {
    console.error('Error fetching customers with debt:', error);
    return [];
  }
}

export async function getCustomerById(id: string) {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
          include: {
            items: {
              include: { product: true }
            },
            transaction: {
              include: { account: true }
            },
            invoice: true,
          }
        },
        leads: { orderBy: { createdAt: 'desc' } },
        deals: { orderBy: { createdAt: 'desc' } },
        tickets: { orderBy: { createdAt: 'desc' } },
      }
    });

    if (!customer) return null;

    // Calculate debt
    const totalDebt = customer.orders.reduce((sum, order) => {
      const orderTotal = Number(order.totalAmount) - Number(order.discount);
      const debt = orderTotal - Number(order.paidAmount);
      return sum + debt;
    }, 0);

    // Calculate stats
    const totalOrders = customer.orders.length;
    const totalSpent = customer.orders.reduce((sum, order) => 
      sum + Number(order.paidAmount), 0
    );
    const averageOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0;

    return {
      ...customer,
      stats: {
        totalDebt,
        totalOrders,
        totalSpent,
        averageOrderValue,
      }
    };
  } catch (error) {
    console.error('Error fetching customer by ID:', error);
    return null;
  }
}

export async function calculateCustomerDebt(customerId: string): Promise<number> {
  try {
    const orders = await prisma.order.findMany({
      where: {
        customerId,
        paymentStatus: { in: ['PARTIAL', 'UNPAID'] }
      },
      select: {
        totalAmount: true,
        discount: true,
        paidAmount: true,
      }
    });

    return orders.reduce((sum, order) => {
      const orderTotal = Number(order.totalAmount) - Number(order.discount);
      const debt = orderTotal - Number(order.paidAmount);
      return sum + debt;
    }, 0);
  } catch (error) {
    console.error('Error calculating customer debt:', error);
    return 0;
  }
}

export async function getCustomerStats(customerId: string) {
  try {
    const orders = await prisma.order.findMany({
      where: { customerId },
      select: {
        totalAmount: true,
        paidAmount: true,
        discount: true,
        paymentStatus: true,
        createdAt: true,
      }
    });

    const totalOrders = orders.length;
    const totalSpent = orders.reduce((sum, order) => sum + Number(order.paidAmount), 0);
    const totalDebt = orders.reduce((sum, order) => {
      if (order.paymentStatus === 'PAID') return sum;
      const orderTotal = Number(order.totalAmount) - Number(order.discount);
      return sum + (orderTotal - Number(order.paidAmount));
    }, 0);
    const averageOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0;

    // Calculate order frequency (orders per month)
    const firstOrder = orders[orders.length - 1];
    const monthsSinceFirst = firstOrder 
      ? Math.max(1, Math.ceil((Date.now() - new Date(firstOrder.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30)))
      : 1;
    const orderFrequency = totalOrders / monthsSinceFirst;

    return {
      totalOrders,
      totalSpent,
      totalDebt,
      averageOrderValue,
      orderFrequency,
      lastOrderDate: orders[0]?.createdAt || null,
    };
  } catch (error) {
    console.error('Error getting customer stats:', error);
    return null;
  }
}

export async function updateCustomerCredit(id: string, creditLimit: number, paymentTerms: number) {
  try {
    await prisma.customer.update({
      where: { id },
      data: {
        creditLimit,
        paymentTerms,
      },
    });

    revalidatePath(`/dashboard/crm/customers/${id}`);
    return { success: true, message: 'اطلاعات اعتباری بروزرسانی شد.' };
  } catch (error) {
    console.error('Error updating customer credit:', error);
    return { success: false, message: 'خطا در بروزرسانی اطلاعات اعتباری.' };
  }
}

export async function updateCustomerSegment(id: string, segment: string | null) {
  try {
    await prisma.customer.update({
      where: { id },
      data: { segment },
    });

    revalidatePath(`/dashboard/crm/customers`);
    revalidatePath(`/dashboard/crm/customers/${id}`);
    return { success: true, message: 'دسته‌بندی مشتری بروزرسانی شد.' };
  } catch (error) {
    console.error('Error updating customer segment:', error);
    return { success: false, message: 'خطا در بروزرسانی دسته‌بندی.' };
  }
}
