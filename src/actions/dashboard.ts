'use server';

import { PrismaClient } from '@prisma/client';
import { auth } from '@/auth';

import { prisma } from '@/lib/prisma';

// const prisma = new PrismaClient();

/**
 * Dashboard Financial Overview
 */
export async function getDashboardFinancials() {
  try {
    // Total Balance (all bank/cash accounts)
    const accounts = await prisma.account.findMany({
      where: {
        type: {
          in: ['Bank', 'Cash']
        }
      }
    });
    
    const totalBalance = accounts.reduce((sum: any, acc: any) => sum + Number(acc.balance), 0);

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

    // Total Payables (received purchase orders - simplified)
    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where: {
        status: 'RECEIVED'
      }
    });
    
    const totalPayables = purchaseOrders.reduce((sum: any, po: any) => sum + Number(po.totalAmount), 0);

    return {
      totalBalance,
      totalReceivables,
      totalPayables,
    };
  } catch (error) {
    console.error('Error fetching dashboard financials:', error);
    return {
      totalBalance: 0,
      totalReceivables: 0,
      totalPayables: 0,
    };
  }
}

/**
 * Dashboard Sales Data
 */
export async function getDashboardSales() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

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
        DATE("createdAt") as date,
        SUM("totalAmount")::float as total,
        COUNT(*)::int as count
      FROM "Order"
      WHERE "createdAt" >= ${thirtyDaysAgo}
        AND status != 'CANCELLED'
      GROUP BY DATE("createdAt")
      ORDER BY DATE("createdAt") ASC
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
      deadline: undefined, // Task model doesn't have deadline field
      priority: 'MEDIUM' // Task model doesn't have priority field
    }));
  } catch (error) {
    console.error('Error fetching user tasks:', error);
    return [];
  }
}

