'use server';

import { PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/prisma';

// const prisma = new PrismaClient();

interface ProductAnalytics {
  productId: string;
  productName: string;
  sku: string;
  image: string | null;
  
  // Sales metrics
  totalUnitsSold: number;
  totalRevenue: number;
  averageSellingPrice: number;
  
  // Profit metrics
  averageCostPrice: number;
  totalProfit: number;
  profitMargin: number; // percentage
  
  // Sales by channel
  salesByChannel: {
    POS: number;
    Online: number;
    Consignment: number;
  };
  
  // Sales by warehouse
  salesByWarehouse: Array<{
    warehouseId: string;
    warehouseName: string;
    unitsSold: number;
    revenue: number;
  }>;
  
  // Current stock
  stockByWarehouse: Array<{
    warehouseId: string;
    warehouseName: string;
    quantity: number;
    isLowStock: boolean;
  }>;
  
  // Sales history (last 30 days)
  salesHistory: Array<{
    date: string;
    units: number;
    revenue: number;
  }>;
}

export async function getProductAnalytics(productId: string): Promise<ProductAnalytics | undefined> {
  try {
    // Get product details
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        orderItems: {
          include: {
            order: {
              include: {
                customer: {
                  include: {
                    warehouses: true // Customer has multiple warehouses (consignment)
                  }
                }
              }
            }
          }
        },
        inventory: {
          include: {
            warehouse: true
          }
        }
      }
    });

    if (!product) return undefined;

    // Calculate sales metrics
    let totalUnitsSold = 0;
    let totalRevenue = 0;
    let totalCost = 0;
    const salesByChannel = { POS: 0, Online: 0, Consignment: 0 };
    const salesByWarehouseMap: Record<string, { name: string; units: number; revenue: number }> = {};
    const salesHistoryMap: Record<string, { units: number; revenue: number }> = {};

    product.orderItems.forEach((item: any) => {
      const units = item.quantity;
      const revenue = Number(item.price) * units;
      const cost = Number(product.costPrice) * units;

      totalUnitsSold += units;
      totalRevenue += revenue;
      totalCost += cost;

      // Determine channel
      const order = item.order;
      if (order.wooId) {
        salesByChannel.Online += units;
      } else if (order.customer?.warehouses?.some((w: any) => w.isVirtual)) {
        salesByChannel.Consignment += units;
      } else {
        salesByChannel.POS += units;
      }

      // Sales history (by date)
      const dateKey = order.createdAt.toISOString().split('T')[0];
      if (!salesHistoryMap[dateKey]) {
        salesHistoryMap[dateKey] = { units: 0, revenue: 0 };
      }
      salesHistoryMap[dateKey].units += units;
      salesHistoryMap[dateKey].revenue += revenue;
    });

    // Calculate stock by warehouse
    const stockByWarehouse = product.inventory.map((inv: any) => ({
      warehouseId: inv.warehouseId,
      warehouseName: inv.warehouse.name,
      quantity: inv.quantity,
      isLowStock: inv.quantity < 10, // Threshold: 10 units
    }));

    // Format sales history
    const salesHistory = Object.entries(salesHistoryMap)
      .map(([date, data]) => ({
        date,
        units: data.units,
        revenue: data.revenue,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30); // Last 30 days

    // Calculate profit metrics
    const totalProfit = totalRevenue - totalCost;
    const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const averageSellingPrice = totalUnitsSold > 0 ? totalRevenue / totalUnitsSold : 0;
    const averageCostPrice = Number(product.costPrice);

    return {
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      image: product.image,
      totalUnitsSold,
      totalRevenue,
      averageSellingPrice,
      averageCostPrice,
      totalProfit,
      profitMargin,
      salesByChannel,
      salesByWarehouse: Object.entries(salesByWarehouseMap).map(([id, data]) => ({
        warehouseId: id,
        warehouseName: data.name,
        unitsSold: data.units,
        revenue: data.revenue,
      })),
      stockByWarehouse,
      salesHistory,
    };
  } catch (error) {
    console.error('Error fetching product analytics:', error);
    return undefined;
  }
}

export async function getProductSalesByWarehouse(productId: string) {
  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        orderItems: {
          include: {
            order: true
          }
        }
      }
    });

    if (!product) return [];

    const warehouseSales: Record<string, { units: number; revenue: number }> = {};

    product.orderItems.forEach((item) => {
      const warehouseId = 'default'; // Would need to track warehouse per order
      const units = item.quantity;
      const revenue = Number(item.price) * units;

      if (!warehouseSales[warehouseId]) {
        warehouseSales[warehouseId] = { units: 0, revenue: 0 };
      }

      warehouseSales[warehouseId].units += units;
      warehouseSales[warehouseId].revenue += revenue;
    });

    return Object.entries(warehouseSales).map(([id, data]) => ({
      warehouseId: id,
      units: data.units,
      revenue: data.revenue,
    }));
  } catch (error) {
    console.error('Error fetching sales by warehouse:', error);
    return [];
  }
}

export async function getProductStockByWarehouse(productId: string) {
  try {
    const inventory = await prisma.inventory.findMany({
      where: { productId },
      include: { warehouse: true },
    });

    return inventory.map((inv) => ({
      warehouseId: inv.warehouseId,
      warehouseName: inv.warehouse.name,
      quantity: inv.quantity,
      isVirtual: inv.warehouse.isVirtual,
    }));
  } catch (error) {
    console.error('Error fetching stock by warehouse:', error);
    return [];
  }
}
