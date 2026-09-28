'use server';

import { PrismaClient } from '@prisma/client';
import { auth } from '@/auth';
import { requirePermission } from '@/lib/access';
import { cashPosition, latestRates, supplierPositions } from '@/lib/money-totals';
import { addDays, tehranDay, tehranDayStart } from '@/lib/tehran-day';

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

    // Total Receivables (actual unpaid amounts from orders)
    // فقط سفارشات با مشتری - سفارشات Guest (نقدی) طلبکار نیستند
    const allOrders = await prisma.order.findMany({
      where: {
        customerId: { not: null },  // فقط سفارشات با مشتری
        status: {
          not: 'CANCELLED'
        },
        paymentStatus: {
          in: ['UNPAID', 'PARTIAL']
        }
      },
      select: {
        totalAmount: true,
        paidAmount: true
      }
    });

    // Calculate actual receivables: totalAmount - paidAmount
    // توجه: totalAmount در WooCommerce قبلاً تخفیف را کم کرده است، پس نباید دوباره کم کنیم
    const totalReceivables = allOrders.reduce((sum: any, order: any) => {
      const unpaid = Number(order.totalAmount) - Number(order.paidAmount || 0);
      return sum + (unpaid > 0 ? unpaid : 0);
    }, 0);

    // Total Payables: what is still unpaid on the purchase orders placed with
    // suppliers, in Toman, the balance sheet's figure too (src/lib/money-totals.ts).
    const totalPayables = (await supplierPositions(prisma, rates)).payables;

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
      select: {
        totalAmount: true
      }
    });

    const salesToday = {
      total: ordersToday.reduce((sum: any, order: any) => sum + Number(order.totalAmount), 0),
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
      select: {
        totalAmount: true
      }
    });

    const salesYesterday = {
      total: ordersYesterday.reduce((sum: any, order: any) => sum + Number(order.totalAmount), 0)
    };

    // Last 30 days daily sales for chart
    const dailySales = await prisma.$queryRaw<Array<{ date: Date; total: number; count: number }>>`
      SELECT 
        DATE(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tehran') as date,
        SUM("totalAmount")::float as total,
        COUNT(*)::int as count
      FROM "Order"
      WHERE "createdAt" >= ${thirtyDaysAgo}
        AND status != 'CANCELLED'
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    // Top 5 products
    const topProducts = await prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        order: {
          createdAt: {
            gte: thirtyDaysAgo
          },
          status: {
            not: 'CANCELLED'
          }
        }
      },
      _sum: {
        quantity: true
      },
      orderBy: {
        _sum: {
          quantity: 'desc'
        }
      },
      take: 5
    });

    // Get product details
    const topProductsWithDetails = await Promise.all(
      topProducts.map(async (item: any) => {
        const product = await prisma.product.findUnique({
          where: { id: item.productId }
        });
        return {
          id: item.productId,
          name: product?.name || 'Unknown',
          units: item._sum.quantity || 0
        };
      })
    );

    return {
      today: salesToday,
      yesterday: salesYesterday,
      dailySales: dailySales.map((day: any) => ({
        date: day.date.toISOString().split('T')[0],
        total: Number(day.total),
        count: day.count
      })),
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
 * Low Stock Items (Below threshold)
 */
export async function getLowStockItems(threshold: number = 10) {
  await requirePermission('stock.view');
  try {
    const lowStockProducts = await prisma.product.findMany({
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
      .filter((item: any) => item.totalStock < threshold)
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

