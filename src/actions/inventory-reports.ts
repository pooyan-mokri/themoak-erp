'use server';

import { prisma } from '@/lib/prisma';

export async function getInventoryReport() {
  try {
    // Get all saleable products with inventory
    const saleableProducts = await prisma.product.findMany({
      where: {
        productType: 'SALEABLE',
      },
      include: {
        inventory: {
          include: {
            warehouse: true,
          },
        },
      },
    });

    // Calculate total inventory value and quantity for saleable products
    let totalValue = 0;
    let totalQuantity = 0;
    const lowStockItems: any[] = [];
    const outOfStockItems: any[] = [];
    const warehouseDistribution: Record<string, { quantity: number; value: number }> = {};

    saleableProducts.forEach((product: any) => {
      const costPrice = Number(product.costPrice || 0);
      const sellPrice = Number(product.sellPrice || 0);
      
      product.inventory.forEach((inv: any) => {
        const quantity = inv.quantity;
        const value = quantity * costPrice;
        
        totalQuantity += quantity;
        totalValue += value;

        // Track warehouse distribution
        const warehouseName = inv.warehouse.name;
        if (!warehouseDistribution[warehouseName]) {
          warehouseDistribution[warehouseName] = { quantity: 0, value: 0 };
        }
        warehouseDistribution[warehouseName].quantity += quantity;
        warehouseDistribution[warehouseName].value += value;

        // Check for low stock (less than 10 units)
        if (quantity > 0 && quantity <= 10) {
          lowStockItems.push({
            productId: product.id,
            productName: product.name,
            sku: product.sku,
            warehouseName: inv.warehouse.name,
            quantity,
            costPrice,
            sellPrice,
            value,
          });
        }

        // Check for out of stock
        if (quantity === 0) {
          outOfStockItems.push({
            productId: product.id,
            productName: product.name,
            sku: product.sku,
            warehouseName: inv.warehouse.name,
            costPrice,
            sellPrice,
          });
        }
      });

      // Check products with no inventory at all
      if (product.inventory.length === 0) {
        outOfStockItems.push({
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          warehouseName: 'بدون موجودی',
          costPrice,
          sellPrice,
        });
      }
    });

    // Get top products by quantity
    const topProductsByQuantity = saleableProducts
      .map((product: any) => {
        const totalQty = product.inventory.reduce((sum: any, inv: any) => sum + inv.quantity, 0);
        return {
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          quantity: totalQty,
          costPrice: Number(product.costPrice || 0),
          sellPrice: Number(product.sellPrice || 0),
          value: totalQty * Number(product.costPrice || 0),
        };
      })
      .filter((p: any) => p.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    // Get top products by value
    const topProductsByValue = saleableProducts
      .map((product: any) => {
        const totalQty = product.inventory.reduce((sum: any, inv: any) => sum + inv.quantity, 0);
        const costPrice = Number(product.costPrice || 0);
        return {
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          quantity: totalQty,
          costPrice,
          sellPrice: Number(product.sellPrice || 0),
          value: totalQty * costPrice,
        };
      })
      .filter((p: any) => p.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    // Get total number of unique products
    const totalUniqueProducts = saleableProducts.length;

    // Get total number of warehouses
    const totalWarehouses = await prisma.warehouse.count({
      where: { isVirtual: false },
    });

    return {
      summary: {
        totalValue,
        totalQuantity,
        totalUniqueProducts,
        totalWarehouses,
        lowStockCount: lowStockItems.length,
        outOfStockCount: outOfStockItems.length,
      },
      lowStockItems: lowStockItems.slice(0, 20), // Limit to 20 items
      outOfStockItems: outOfStockItems.slice(0, 20), // Limit to 20 items
      topProductsByQuantity,
      topProductsByValue,
      warehouseDistribution: Object.entries(warehouseDistribution).map(([name, data]) => ({
        warehouseName: name,
        quantity: data.quantity,
        value: data.value,
      })),
    };
  } catch (error) {
    console.error('Error fetching inventory report:', error);
    return {
      summary: {
        totalValue: 0,
        totalQuantity: 0,
        totalUniqueProducts: 0,
        totalWarehouses: 0,
        lowStockCount: 0,
        outOfStockCount: 0,
      },
      lowStockItems: [],
      outOfStockItems: [],
      topProductsByQuantity: [],
      topProductsByValue: [],
      warehouseDistribution: [],
    };
  }
}

