'use server';

import { PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { formatJalaliDate } from '@/lib/date-utils';

// const prisma = new PrismaClient();

/**
 * Get complete product details with all analytics
 */
export async function getProductDetail(productId: string) {
  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        productType: true,
        costPrice: true,
        sellPrice: true,
        image: true,
        createdAt: true,
        updatedAt: true,
        inventory: {
          include: {
            warehouse: true
          }
        }
      }
    });

    if (!product) {
      return undefined;
    }

    // Calculate totals
    const totalStock = product.inventory.reduce((sum, inv) => sum + inv.quantity, 0);
    const availableStock = product.inventory
      .filter(inv => !inv.warehouse.isVirtual)
      .reduce((sum, inv) => sum + inv.quantity, 0);
    const stockValue = totalStock * Number(product.costPrice);

    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode ?? undefined,
      image: product.image ?? undefined,
      costPrice: Number(product.costPrice),
      sellPrice: Number(product.sellPrice),
      totalStock,
      availableStock,
      stockValue,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt
    };
  } catch (error) {
    console.error('Error fetching product detail:', error);
    return undefined;
  }
}

/**
 * Get stock breakdown by warehouse
 */
export async function getProductStockBreakdown(productId: string) {
  try {
    const inventory = await prisma.inventory.findMany({
      where: { productId },
      include: {
        warehouse: true
      }
    });

    return inventory.map(inv => ({
      warehouseId: inv.warehouse.id,
      warehouseName: inv.warehouse.name,
      isVirtual: inv.warehouse.isVirtual,
      quantity: inv.quantity,
      status: inv.quantity < 10 ? 'LOW' : 'OK'
    }));
  } catch (error) {
    console.error('Error fetching stock breakdown:', error);
    return [];
  }
}

/**
 * Get product sales analytics
 */
export async function getProductSalesAnalytics(productId: string) {
  try {
    // Get all order items for this product
    const orderItems = await prisma.orderItem.findMany({
      where: {
        productId,
        order: {
          status: {
            not: 'CANCELLED'
          }
        }
      },
      include: {
        order: {
          select: {
            createdAt: true,
            status: true
          }
        }
      }
    });

    // Calculate metrics
    const totalUnitsSold = orderItems.reduce((sum, item) => sum + item.quantity, 0);
    const totalRevenue = orderItems.reduce((sum, item) => sum + (item.quantity * Number(item.price)), 0);
    const avgSellingPrice = totalUnitsSold > 0 ? totalRevenue / totalUnitsSold : 0;

    // Calculate velocity (items per time period)
    const oldestOrder = orderItems.length > 0 
      ? new Date(Math.min(...orderItems.map(item => item.order.createdAt.getTime())))
      : new Date();
    const daysSinceFirstSale = (Date.now() - oldestOrder.getTime()) / (1000 * 60 * 60 * 24);
    const weeksSinceFirstSale = daysSinceFirstSale / 7;
    const monthsSinceFirstSale = daysSinceFirstSale / 30;
    const yearsSinceFirstSale = daysSinceFirstSale / 365;

    return {
      totalUnitsSold,
      totalRevenue,
      avgSellingPrice,
      velocityPerWeek: weeksSinceFirstSale > 0 ? totalUnitsSold / weeksSinceFirstSale : 0,
      velocityPerMonth: monthsSinceFirstSale > 0 ? totalUnitsSold / monthsSinceFirstSale : 0,
      velocityPerYear: yearsSinceFirstSale > 0 ? totalUnitsSold / yearsSinceFirstSale : 0
    };
  } catch (error) {
    console.error('Error fetching sales analytics:', error);
    return {
      totalUnitsSold: 0,
      totalRevenue: 0,
      avgSellingPrice: 0,
      velocityPerWeek: 0,
      velocityPerMonth: 0,
      velocityPerYear: 0
    };
  }
}

/**
 * Get product movement history
 */
export async function getProductMovementHistory(productId: string, limit: number = 20) {
  try {
    // Get sales from orders
    const sales = await prisma.orderItem.findMany({
      where: { productId },
      include: {
        order: {
          select: {
            createdAt: true,
            status: true,
            customer: {
              select: {
                name: true
              }
            }
          }
        }
      },
      orderBy: {
        order: {
          createdAt: 'desc'
        }
      },
      take: limit
    });

    // Get purchases from purchase orders
    const purchases = await prisma.purchaseOrderItem.findMany({
      where: { productId },
      include: {
        purchaseOrder: {
          select: {
            createdAt: true,
            status: true,
            supplier: {
              select: {
                name: true
              }
            }
          }
        }
      },
      orderBy: {
        purchaseOrder: {
          createdAt: 'desc'
        }
      },
      take: limit
    });

    // Combine and format movements
    const movements = [
      ...sales.map(item => ({
        id: item.id,
        date: item.order.createdAt,
        dateFormatted: formatJalaliDate(item.order.createdAt, 'jYYYY/jMM/jDD HH:mm'),
        type: 'SALE' as const,
        quantity: -item.quantity,
        reference: item.order.customer?.name || 'Walk-in',
        status: item.order.status
      })),
      ...purchases.map(item => ({
        id: item.id,
        date: item.purchaseOrder.createdAt,
        dateFormatted: formatJalaliDate(item.purchaseOrder.createdAt, 'jYYYY/jMM/jDD HH:mm'),
        type: 'PURCHASE' as const,
        quantity: item.quantity,
        reference: item.purchaseOrder.supplier.name,
        status: item.purchaseOrder.status
      }))
    ];

    // Sort by date descending and limit
    return movements
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, limit);
  } catch (error) {
    console.error('Error fetching movement history:', error);
    return [];
  }
}

/**
 * Get sales history for chart (last N months)
 */
export async function getProductSalesHistory(productId: string, months: number = 12) {
  try {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    // Use Prisma query instead of raw SQL for better compatibility
    const orderItems = await prisma.orderItem.findMany({
      where: {
        productId,
        order: {
          createdAt: {
            gte: startDate
          },
          status: {
            not: 'CANCELLED'
          }
        }
      },
      include: {
        order: {
          select: {
            createdAt: true
          }
        }
      }
    });

    // Group by month
    const monthlyData = new Map<string, { units: number; revenue: number }>();
    
    orderItems.forEach(item => {
      const date = new Date(item.order.createdAt);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      const existing = monthlyData.get(monthKey) || { units: 0, revenue: 0 };
      existing.units += item.quantity;
      existing.revenue += item.quantity * Number(item.price);
      monthlyData.set(monthKey, existing);
    });

    // Convert to array and sort
    return Array.from(monthlyData.entries())
      .map(([month, data]) => ({
        month,
        units: data.units,
        revenue: data.revenue
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  } catch (error) {
    console.error('Error fetching sales history:', error);
    return [];
  }
}
