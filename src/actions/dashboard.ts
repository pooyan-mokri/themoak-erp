'use server';

import { PrismaClient } from '@prisma/client';
import { auth } from '@/auth';
import { requirePermission } from '@/lib/access';
import { cashPosition, customerReceivables, latestRates, supplierPositions } from '@/lib/money-totals';
import { addDays, tehranDay, tehranDayStart } from '@/lib/tehran-day';
import { orderNet } from '@/lib/order-balance';
import { SALE_LINE_INCLUDE, netLineSale } from '@/lib/product-sales';
import { STOCK_TYPES, stockLevel } from '@/lib/stock-levels';

import { prisma } from '@/lib/prisma';

// const prisma = new PrismaClient();

/**
 * Dashboard Financial Overview
 */
export async function getDashboardFinancials() {
  await requirePermission('finance.view');
  try {
    // Total Balance: every account that holds money (bank, cash box, person,
    // crypto wallet), foreign ones at the latest rate (src/lib/money-totals.ts).
    // EXPENSE-type accounts are P&L buckets, not money.
    const accounts = await prisma.account.findMany({
      where: { type: { not: 'EXPENSE' } },
    });

    const rates = await latestRates(prisma);
    const balances = cashPosition(accounts, rates);
    const totalBalance = balances.total;

    // Total Receivables: what customers still owe on their orders, after the
    // discount (src/lib/money-totals.ts). Guest sales are paid at the till.
    const totalReceivables = await customerReceivables(prisma);

    // Still to pay suppliers: what is unpaid on the purchase orders placed with
    // them, in Toman (src/lib/money-totals.ts). Operational: the balance sheet
    // owes only for goods received.
    const totalPayables = (await supplierPositions(prisma, rates)).unpaidOnOrders;

    return {
      totalBalance,
      balancesByType: balances.byType,
      foreignBalances: balances.foreign,
      unpricedBalances: balances.unpriced,
      totalReceivables,
      totalPayables,
    };
  } catch (error) {
    console.error('Error fetching dashboard financials:', error);
    return {
      totalBalance: 0,
      balancesByType: [],
      foreignBalances: [],
      unpricedBalances: [],
      totalReceivables: 0,
      totalPayables: 0,
    };
  }
}

/**
 * Dashboard Sales Data
 */
export async function getDashboardSales() {
  await requirePermission('finance.view');
  try {
    // Tehran's days, not the server's (it runs in UTC): src/lib/tehran-day.ts.
    const todayInTehran = tehranDay(new Date());
    const today = tehranDayStart(todayInTehran);
    const yesterday = tehranDayStart(addDays(todayInTehran, -1));
    const thirtyDaysAgo = tehranDayStart(addDays(todayInTehran, -30));

    // An order's sale is what its customer pays for it, after the discount (src/lib/order-balance.ts).
    const money = { totalAmount: true, discount: true, wooId: true, siteReference: true } as const;

    // Sales today
    const ordersToday = await prisma.order.findMany({
      where: {
        createdAt: {
          gte: today
        },
        status: {
          not: 'CANCELLED'
        }
      },
      select: money
    });

    const salesToday = {
      total: ordersToday.reduce((sum: any, order: any) => sum + orderNet(order), 0),
      count: ordersToday.length
    };

    // Sales yesterday
    const ordersYesterday = await prisma.order.findMany({
      where: {
        createdAt: {
          gte: yesterday,
          lt: today
        },
        status: {
          not: 'CANCELLED'
        }
      },
      select: money
    });

    const salesYesterday = {
      total: ordersYesterday.reduce((sum: any, order: any) => sum + orderNet(order), 0)
    };

    // The last 30 days, by Tehran day: each day's sales for the chart, and the
    // units sold net of returns and exchanges (src/lib/product-sales.ts).
    const recentOrders = await prisma.order.findMany({
      where: { createdAt: { gte: thirtyDaysAgo }, status: { not: 'CANCELLED' } },
      select: { ...money, createdAt: true, items: { include: { product: { select: { name: true } }, ...SALE_LINE_INCLUDE } } },
      orderBy: { createdAt: 'asc' },
    });
    const byDay = new Map<string, { date: string; total: number; count: number }>();
    const units = new Map<string, { id: string; name: string; units: number }>();
    for (const order of recentOrders as any[]) {
      const date = tehranDay(order.createdAt);
      const day = byDay.get(date) ?? { date, total: 0, count: 0 };
      day.total += orderNet(order);
      day.count += 1;
      byDay.set(date, day);
      for (const item of order.items) {
        const row = units.get(item.productId) ?? { id: item.productId, name: item.product?.name || 'نامشخص', units: 0 };
        row.units += netLineSale(item, order).units;
        units.set(item.productId, row);
      }
    }
    // Top 5 products by units
    const topProductsWithDetails = [...units.values()]
      .filter((row) => row.units > 0)
      .sort((a, b) => b.units - a.units)
      .slice(0, 5);

    return {
      today: salesToday,
      yesterday: salesYesterday,
      dailySales: [...byDay.values()],
      topProducts: topProductsWithDetails
    };
  } catch (error) {
    console.error('Error fetching dashboard sales:', error);
    return {
      today: { total: 0, count: 0 },
      yesterday: { total: 0 },
      dailySales: [],
      topProducts: []
    };
  }
}

/**
 * Low stock items: the stock products (src/lib/stock-levels.ts) with 3 units
 * or fewer in all, out of stock included, the lowest first.
 */
export async function getLowStockItems() {
  await requirePermission('stock.view');
  try {
    const lowStockProducts = await prisma.product.findMany({
      where: { productType: { in: [...STOCK_TYPES] } },
      include: {
        inventory: {
          include: {
            warehouse: true
          }
        }
      }
    });

    const itemsBelowThreshold = lowStockProducts
      .map((product: any) => {
        const totalStock = product.inventory.reduce((sum: any, inv: any) => sum + inv.quantity, 0);
        return {
          id: product.id,
          name: product.name,
          sku: product.sku,
          totalStock,
          warehouses: product.inventory.map((inv: any) => ({
            name: inv.warehouse.name,
            quantity: inv.quantity
          }))
        };
      })
      .filter((item: any) => stockLevel(item.totalStock) !== 'OK')
      .sort((a: any, b: any) => a.totalStock - b.totalStock)
      .slice(0, 10); // Top 10 lowest

    return itemsBelowThreshold;
  } catch (error) {
    console.error('Error fetching low stock items:', error);
    return [];
  }
}

/**
 * Recent Activity Log
 */
export async function getRecentActivity(limit: number = 5) {
  try {
    // Every user's activity: for an admin only.
    const session = await auth();
    if (!session?.user || session.user.role !== 'ADMIN') return [];

    const activities = await prisma.activityLog.findMany({
      take: limit,
      orderBy: {
        createdAt: 'desc'
      },
      include: {
        user: {
          select: {
            name: true
          }
        }
      }
    });

    return activities.map((log: any) => ({
      id: log.id,
      userName: log.user?.name || 'System',
      action: log.action,
      description: log.details, // Fixed: use 'details' not 'description'
      timestamp: log.createdAt
    }));
  } catch (error) {
    console.error('Error fetching recent activity:', error);
    return [];
  }
}

/**
 * User's Open Tasks
 */
export async function getUserTasks() {
  try {
    const session = await auth();
    if (!session?.user?.id) return [];

    const tasks = await prisma.task.findMany({
      where: {
        assignedTo: session.user.id,
        status: {
          notIn: ['DONE', 'COMPLETED']
        }
      },
      include: {
        project: {
          select: {
            name: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 5
    });

    return tasks.map((task: any) => ({
      id: task.id,
      title: task.title,
      projectName: task.project.name,
      status: task.status,
      deadline: task.dueDate ?? undefined,
      priority: task.priority,
    }));
  } catch (error) {
    console.error('Error fetching user tasks:', error);
    return [];
  }
}

