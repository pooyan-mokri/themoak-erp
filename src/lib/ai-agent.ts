// AI Agent with system access capabilities

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, any>;
  execute: (params: any) => Promise<any>;
}

// Define available tools for the AI agent
export const agentTools: AgentTool[] = [
  {
    name: 'get_inventory_summary',
    description: 'دریافت خلاصه موجودی انبار - تعداد کل محصولات، ارزش کل، محصولات با موجودی کم',
    parameters: {
      warehouseId: 'string (optional) - شناسه انبار',
    },
    execute: async (params: { warehouseId?: string }) => {
      try {
        const where = params.warehouseId ? { warehouseId: params.warehouseId } : {};
        
        const inventory = await prisma.inventory.findMany({
          where,
          include: { product: true, warehouse: true },
        });

        const totalItems = inventory.reduce((sum: any, item: any) => sum + item.quantity, 0);
        const totalValue = inventory.reduce(
  (sum: any, item: any) => sum + item.quantity * Number(item.product.costPrice),
          0
        );
        const lowStockItems = inventory.filter((item: any) => item.quantity < 10 && item.quantity > 0);

        return {
          success: true,
          totalProducts: inventory.length,
          totalItems,
          totalValue,
          lowStockCount: lowStockItems.length,
          lowStockItems: lowStockItems.slice(0, 10).map((item: any) => ({
            product: item.product.name,
            warehouse: item.warehouse.name,
            quantity: item.quantity,
          })),
        };
      } catch (error: any) {
        console.error('Error in get_inventory_summary:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    },
  },
  {
    name: 'get_sales_summary',
    description: 'دریافت خلاصه فروش - کل فروش، تعداد سفارشات، میانگین فروش در یک بازه زمانی',
    parameters: {
      days: 'number (optional) - تعداد روزهای گذشته (پیش‌فرض: 30)',
    },
    execute: async (params: { days?: number }) => {
      const days = params.days || 30;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const orders = await prisma.order.findMany({
        where: {
          createdAt: { gte: startDate },
          status: { in: ['COMPLETED', 'DELIVERED'] },
        },
        include: {
          items: { include: { product: true } },
          customer: true,
        },
      });

      const totalRevenue = orders.reduce((sum: any, order: any) => sum + Number(order.totalAmount), 0);
      const totalOrders = orders.length;
      const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      return {
        period: `${days} روز گذشته`,
        totalRevenue,
        totalOrders,
        averageOrderValue,
        topCustomers: orders
          .reduce((acc: any, order: any) => {
            const customerId = order.customerId || 'walk-in';
            const customerName = order.customer?.name || 'مشتری عمومی';
            if (!acc[customerId]) {
              acc[customerId] = { name: customerName, orders: 0, revenue: 0 };
            }
            acc[customerId].orders += 1;
            acc[customerId].revenue += Number(order.totalAmount);
            return acc;
          }, {} as Record<string, any>)
      };
    },
  },
  {
    name: 'get_customer_info',
    description: 'دریافت اطلاعات مشتری - نام، تلفن، بدهی، تاریخچه خرید',
    parameters: {
      customerId: 'string - شناسه مشتری',
    },
    execute: async (params: { customerId: string }) => {
      const customer = await prisma.customer.findUnique({
        where: { id: params.customerId },
        include: {
          orders: {
            orderBy: { createdAt: 'desc' },
            take: 10,
          },
        },
      });

      if (!customer) {
        return { error: 'مشتری یافت نشد' };
      }

      const totalOrders = customer.orders.length;
      const totalSpent = customer.orders.reduce((sum: any, order: any) => sum + Number(order.totalAmount), 0);

      return {
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        creditLimit: Number(customer.creditLimit),
        totalOrders,
        totalSpent,
        recentOrders: customer.orders.slice(0, 5).map((order: any) => ({
          number: order.number,
          amount: Number(order.totalAmount),
          date: order.createdAt,
        })),
      };
    },
  },
  {
    name: 'search_products',
    description: 'جستجوی محصولات - بر اساس نام یا SKU. اگر query خالی باشد، همه محصولات را برمی‌گرداند',
    parameters: {
      query: 'string (optional) - عبارت جستجو. اگر خالی باشد همه محصولات نمایش داده می‌شود',
    },
    execute: async (params: { query?: string }) => {
      try {
        const where = params.query ? {
          OR: [
            { name: { contains: params.query, mode: Prisma.QueryMode.insensitive } },
            { sku: { contains: params.query, mode: Prisma.QueryMode.insensitive } },
          ],
        } : {};
        
        const products = await prisma.product.findMany({
          where,
          include: {
            inventory: {
              include: { warehouse: true },
            },
          },
          take: 20,
        });

        return {
          success: true,
          count: products.length,
          products: products.map((product: any) => ({
            id: product.id,
            name: product.name,
            sku: product.sku || 'ندارد',
            costPrice: Number(product.costPrice),
            sellPrice: Number(product.sellPrice),
            stock: product.inventory.map((inv: any) => ({
              warehouse: inv.warehouse.name,
              quantity: inv.quantity,
            })),
          })),
        };
      } catch (error: any) {
        console.error('Error in search_products:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    },
  },
  {
    name: 'get_financial_summary',
    description: 'دریافت خلاصه مالی - موجودی حساب‌ها، درآمد و هزینه',
    parameters: {
      days: 'number (optional) - تعداد روزهای گذشته (پیش‌فرض: 30)',
    },
    execute: async (params: { days?: number }) => {
      const days = params.days || 30;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const accounts = await prisma.account.findMany({
        where: {
          type: { in: ['BANK', 'CASH'] },
        },
      });

      const transactions = await prisma.transaction.findMany({
        where: {
          date: { gte: startDate },
        },
      });

      const totalIncome = transactions
        .filter((t: any) => t.type === 'INCOME')
        .reduce((sum: any, t: any) => sum + Number(t.amount), 0);

      const totalExpense = transactions
        .filter((t: any) => t.type === 'EXPENSE')
        .reduce((sum: any, t: any) => sum + Number(t.amount), 0);

      return {
        period: `${days} روز گذشته`,
        accounts: accounts.map((acc: any) => ({
          name: acc.name,
          type: acc.type,
          balance: Number(acc.balance),
        })),
        totalIncome,
        totalExpense,
        netProfit: totalIncome - totalExpense,
      };
    },
  },
  {
    name: 'create_customer',
    description: 'ایجاد مشتری جدید',
    parameters: {
      name: 'string - نام مشتری',
      phone: 'string (optional) - شماره تلفن',
      email: 'string (optional) - ایمیل',
      address: 'string (optional) - آدرس',
    },
    execute: async (params: { name: string; phone?: string; email?: string; address?: string }) => {
      const customer = await prisma.customer.create({
        data: {
          name: params.name,
          phone: params.phone,
          email: params.email,
          address: params.address,
        },
      });

      return {
        success: true,
        customerId: customer.id,
        message: `مشتری ${customer.name} با موفقیت ایجاد شد`,
      };
    },
  },
  {
    name: 'record_expense',
    description: 'ثبت هزینه جدید',
    parameters: {
      amount: 'number - مبلغ هزینه',
      description: 'string - شرح هزینه',
      accountId: 'string - شناسه حساب',
      category: 'string (optional) - دسته‌بندی',
    },
    execute: async (params: { amount: number; description: string; accountId: string; category?: string }) => {
      const account = await prisma.account.findUnique({
        where: { id: params.accountId },
      });

      if (!account) {
        return { success: false, error: 'حساب یافت نشد' };
      }

      const transaction = await prisma.transaction.create({
        data: {
          type: 'EXPENSE',
          amount: params.amount,
          accountId: params.accountId,
          category: params.category || 'Other',
          description: params.description,
          date: new Date(),
        },
      });

      await prisma.account.update({
        where: { id: params.accountId },
        data: {
          balance: { decrement: params.amount },
        },
      });

      return {
        success: true,
        transactionId: transaction.id,
        message: `هزینه ${params.amount} تومان با موفقیت ثبت شد`,
      };
    },
  },
];

// Get system context for AI
export async function getSystemContext() {
  const [
    productsCount,
    customersCount,
    ordersCount,
    warehousesCount,
    accounts,
  ] = await Promise.all([
    prisma.product.count(),
    prisma.customer.count(),
    prisma.order.count(),
    prisma.warehouse.count(),
    prisma.account.findMany({
      where: { type: { in: ['BANK', 'CASH'] } },
      select: { name: true, balance: true },
    }),
  ]);

  return {
    system: 'سیستم ERP TheMoak',
    capabilities: [
      'مدیریت موجودی و انبار',
      'فروش و مدیریت مشتریان',
      'خرید و تامین‌کنندگان',
      'حسابداری و مالی',
      'مدیریت پروژه',
      'بازاریابی',
      'CRM',
    ],
    stats: {
      products: productsCount,
      customers: customersCount,
      orders: ordersCount,
      warehouses: warehousesCount,
    },
    accounts: accounts.map((acc: any) => ({
      name: acc.name,
      balance: Number(acc.balance),
    })),
    availableTools: agentTools.map((tool: any) => ({
      name: tool.name,
      description: tool.description,
    })),
  };
}

