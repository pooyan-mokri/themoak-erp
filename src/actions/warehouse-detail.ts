'use server';

import { prisma } from '@/lib/prisma';
import { formatJalaliDate, formatJalaliDateTime } from '@/lib/date-utils';
import { Prisma } from '@prisma/client';

export async function getWarehouseDetail(warehouseId: string) {
  try {
    console.log('Fetching warehouse detail for ID:', warehouseId);
    // Get warehouse info
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      include: {
        customer: true,
      },
    });

    if (!warehouse) {
      console.log('Warehouse not found for ID:', warehouseId);
      return undefined;
    }
    
    console.log('Warehouse found:', warehouse.name);

    // Get inventory items with products
    const inventory = await prisma.inventory.findMany({
      where: { warehouseId },
      include: {
        product: true,
      },
      orderBy: { product: { name: 'asc' } },
    });

    // Calculate statistics
    const totalItems = inventory.reduce((sum: number, item) => sum + item.quantity, 0);
    const totalValue = inventory.reduce(
      (sum: number, item) => sum + item.quantity * Number(item.product.costPrice),
      0
    );
    const uniqueProducts = inventory.length;
    const itemsWithStock = inventory.filter((item) => item.quantity > 0).length;
    const itemsOutOfStock = inventory.filter((item) => item.quantity === 0).length;

    // Get recent order items (sales)
    type OrderItemWithRelations = Prisma.OrderItemGetPayload<{
      include: {
        product: true;
        order: {
          include: {
            customer: true;
          };
        };
      };
    }>;
    
    let recentOrderItems: OrderItemWithRelations[] = [];
    try {
      recentOrderItems = await prisma.orderItem.findMany({
        where: {
          order: {
            status: { in: ['COMPLETED', 'PENDING'] },
          },
        },
        include: {
          product: true,
          order: {
            include: {
              customer: true,
            },
          },
        },
        take: 50,
      });
      // Sort manually by order createdAt
      recentOrderItems.sort((a, b) =>
        new Date(b.order.createdAt).getTime() - new Date(a.order.createdAt).getTime()
      );
    } catch (err) {
      console.error('Error fetching order items:', err);
      recentOrderItems = [];
    }

    // Filter order items that might be from this warehouse
    // (We can't directly link order items to warehouses, but we can show recent sales)
    const relevantOrderItems = recentOrderItems
      .filter((item) => {
        // Check if product exists in this warehouse inventory
        return inventory.some((inv) => inv.productId === item.productId);
      })
      .slice(0, 20);

    // Get recent purchase order items (purchases)
    type PurchaseOrderItemWithRelations = Prisma.PurchaseOrderItemGetPayload<{
      include: {
        product: true;
        purchaseOrder: {
          include: {
            supplier: true;
          };
        };
      };
    }>;
    
    let recentPurchaseItems: PurchaseOrderItemWithRelations[] = [];
    try {
      recentPurchaseItems = await prisma.purchaseOrderItem.findMany({
        where: {
          purchaseOrder: {
            status: { in: ['RECEIVED', 'PARTIALLY_RECEIVED'] },
          },
        },
        include: {
          product: true,
          purchaseOrder: {
            include: {
              supplier: true,
            },
          },
        },
        take: 50,
      });
      // Sort manually by purchaseOrder createdAt
      recentPurchaseItems.sort((a, b) =>
        new Date(b.purchaseOrder.createdAt).getTime() - new Date(a.purchaseOrder.createdAt).getTime()
      );
    } catch (err) {
      console.error('Error fetching purchase items:', err);
      recentPurchaseItems = [];
    }

    // Filter purchase items that might be to this warehouse
    const relevantPurchaseItems = recentPurchaseItems
      .filter((item) => {
        return inventory.some((inv) => inv.productId === item.productId);
      })
      .slice(0, 20);

    // Get recent audits for this warehouse
    const recentAudits = await prisma.inventoryAudit.findMany({
      where: { warehouseId },
      include: {
        createdByUser: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }).catch((err) => {
      console.error('Error fetching audits:', err);
      return [];
    });

    // Format data
    const formattedInventory = inventory
      .map((item) => {
        try {
          if (!item.product) {
            console.warn('Inventory item missing product:', item.productId);
            return undefined;
          }
          return {
            id: item.productId,
            productName: item.product.name,
            sku: item.product.sku || '',
            quantity: item.quantity,
            costPrice: Number(item.product.costPrice),
            sellPrice: Number(item.product.sellPrice),
            totalValue: item.quantity * Number(item.product.costPrice),
            productType: item.product.productType,
          };
        } catch (err) {
          console.error('Error formatting inventory item:', err, item);
          return undefined;
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null && item !== undefined);

    const formattedOrderItems = relevantOrderItems
      .map((item) => {
        try {
          if (!item.product || !item.order) {
            return undefined;
          }
          return {
            id: item.id,
            productName: item.product.name,
            quantity: item.quantity,
            price: Number(item.price),
            total: item.quantity * Number(item.price),
            orderNumber: item.order.number,
            customerName: item.order.customer?.name || 'مشتری عمومی',
            orderDate: formatJalaliDateTime(item.order.createdAt),
            orderDateRaw: item.order.createdAt,
          };
        } catch (err) {
          console.error('Error formatting order item:', err, item);
          return undefined;
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null && item !== undefined);

    const formattedPurchaseItems = relevantPurchaseItems
      .map((item) => {
        try {
          if (!item.product || !item.purchaseOrder) {
            return undefined;
          }
          return {
            id: item.id,
            productName: item.product.name,
            quantity: item.quantity,
            price: Number(item.unitCost),
            total: item.quantity * Number(item.unitCost),
            orderNumber: item.purchaseOrder.number,
            supplierName: item.purchaseOrder.supplier?.name || 'نامشخص',
            orderDate: formatJalaliDateTime(item.purchaseOrder.createdAt),
            orderDateRaw: item.purchaseOrder.createdAt,
          };
        } catch (err) {
          console.error('Error formatting purchase item:', err, item);
          return undefined;
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null && item !== undefined);

    const formattedAudits = recentAudits
      .map((audit) => {
        try {
          return {
            id: audit.id,
            status: audit.status,
            createdBy: audit.createdByUser?.name || 'نامشخص',
            createdAt: formatJalaliDateTime(audit.createdAt),
            createdAtRaw: audit.createdAt,
          };
        } catch (err) {
          console.error('Error formatting audit:', err, audit);
          return undefined;
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null && item !== undefined);

    // Get low stock items
    const lowStockItems = formattedInventory.filter((item) => {
      // Items with quantity less than 10 or items that have been in stock for a while
      return item.quantity < 10 && item.quantity > 0;
    });

    // Get top products by value
    const topProductsByValue = [...formattedInventory]
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, 10);

    return {
      warehouse: {
        id: warehouse.id,
        name: warehouse.name,
        isVirtual: warehouse.isVirtual,
        customer: warehouse.customer
          ? {
              id: warehouse.customer.id,
              name: warehouse.customer.name,
            }
          : undefined,
        createdAt: formatJalaliDate(warehouse.createdAt),
      },
      statistics: {
        totalItems,
        totalValue,
        uniqueProducts,
        itemsWithStock,
        itemsOutOfStock,
        lowStockCount: lowStockItems.length,
      },
      inventory: formattedInventory,
      recentOrderItems: formattedOrderItems,
      recentPurchaseItems: formattedPurchaseItems,
      recentAudits: formattedAudits,
      lowStockItems,
      topProductsByValue,
    };
  } catch (error) {
    console.error('Error fetching warehouse detail:', error);
    if (error instanceof Error) {
      console.error('Error stack:', error.stack);
      console.error('Error message:', error.message);
    }
    return undefined;
  }
}

