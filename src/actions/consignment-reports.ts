'use server';

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export async function getConsignmentReport() {
  try {
    // Get all consignment partners
    const partners = await prisma.warehouse.findMany({
      where: { isVirtual: true, customerId: { not: null } },
      include: {
        customer: true,
        inventory: {
          include: {
            product: true,
          },
        },
      },
    });

    // Get all orders from consignment partners
    const consignmentOrders = await prisma.order.findMany({
      where: {
        customer: {
          warehouses: {
            some: {
              isVirtual: true,
            },
          },
        },
      },
      include: {
        customer: true,
        items: {
          include: {
            product: true,
          },
        },
        commissions: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Calculate statistics for each partner
    const partnerStats = partners.map((partner: any) => {
      const customerId = partner.customerId;
      if (!customerId) return undefined;

      // Get orders for this partner
      const partnerOrders = consignmentOrders.filter(
        (order) => order.customerId === customerId
      );

      // Calculate totals
      const totalSales = partnerOrders.reduce(
        (sum, order) => sum + Number(order.totalAmount) - Number(order.discount || 0),
        0
      );

      const totalPaid = partnerOrders.reduce(
        (sum, order) => sum + Number(order.paidAmount || 0),
        0
      );

      const totalDebt = totalSales - totalPaid;

      // Calculate total commissions
      const totalCommissions = partnerOrders.reduce((sum: any, order: any) => {
        const orderCommissions = order.commissions || [];
        return (
          sum +
          orderCommissions.reduce(
            (s, c) => s + Number(c.commissionAmount),
            0
          )
        );
      }, 0);

      // Calculate paid commissions
      const paidCommissions = partnerOrders.reduce((sum: any, order: any) => {
        const orderCommissions = order.commissions || [];
        return (
          sum +
          orderCommissions
            .filter((c: any) => c.isPaid)
            .reduce((s: any, c: any) => s + Number(c.commissionAmount), 0)
        );
      }, 0);

      // Calculate unpaid commissions
      const unpaidCommissions = totalCommissions - paidCommissions;

      // Calculate inventory value
      const inventoryValue = partner.inventory.reduce((sum: any, inv: any) => {
        const costPrice = Number(inv.product.costPrice || 0);
        return sum + inv.quantity * costPrice;
      }, 0);

      const inventoryQuantity = partner.inventory.reduce(
        (sum, inv) => sum + inv.quantity,
        0
      );

      // Count products in inventory
      const productCount = partner.inventory.length;

      return {
        partnerId: partner.id,
        partnerName: partner.customer?.name || partner.name.replace('انبار امانی - ', ''),
        customerId,
        commissionRate: partner.customer?.commissionRate
          ? Number(partner.customer.commissionRate)
          : undefined,
        totalSales,
        totalPaid,
        totalDebt,
        totalCommissions,
        paidCommissions,
        unpaidCommissions,
        inventoryValue,
        inventoryQuantity,
        productCount,
        orderCount: partnerOrders.length,
        orders: partnerOrders.slice(0, 10).map(order => ({
          ...order,
          discount: order.discount ? Number(order.discount) : undefined,
          paidAmount: order.paidAmount ? Number(order.paidAmount) : undefined,
          customerId: order.customerId ?? undefined,
          wooId: order.wooId ?? undefined,
          transactionId: order.transactionId ?? undefined,
          invoiceId: order.invoiceId ?? undefined,
          customer: order.customer ? {
            ...order.customer,
            phone: order.customer.phone ?? undefined,
            email: order.customer.email ?? undefined,
            address: order.customer.address ?? undefined,
            notes: order.customer.notes ?? undefined,
            wooId: order.customer.wooId ?? undefined,
            taxId: order.customer.taxId ?? undefined,
            segment: order.customer.segment ?? undefined,
          } : undefined,
          items: order.items.map(item => ({
            ...item,
            product: item.product ? {
              ...item.product,
              image: item.product.image ?? undefined,
              wooId: item.product.wooId ?? undefined,
              barcode: item.product.barcode ?? undefined,
            } : undefined,
          })),
        })), // Last 10 orders
      };
    }).filter((p): p is NonNullable<typeof p> => p !== null);

    // Calculate grand totals
    const grandTotals = {
      totalPartners: partnerStats.length,
      totalSales: partnerStats.reduce((sum: any, p: any) => sum + (p?.totalSales || 0), 0),
      totalPaid: partnerStats.reduce((sum: any, p: any) => sum + (p?.totalPaid || 0), 0),
      totalDebt: partnerStats.reduce((sum: any, p: any) => sum + (p?.totalDebt || 0), 0),
      totalCommissions: partnerStats.reduce(
        (sum, p) => sum + (p?.totalCommissions || 0),
        0
      ),
      paidCommissions: partnerStats.reduce(
        (sum, p) => sum + (p?.paidCommissions || 0),
        0
      ),
      unpaidCommissions: partnerStats.reduce(
        (sum, p) => sum + (p?.unpaidCommissions || 0),
        0
      ),
      totalInventoryValue: partnerStats.reduce(
        (sum, p) => sum + (p?.inventoryValue || 0),
        0
      ),
      totalInventoryQuantity: partnerStats.reduce(
        (sum, p) => sum + (p?.inventoryQuantity || 0),
        0
      ),
      totalOrders: partnerStats.reduce((sum: any, p: any) => sum + (p?.orderCount || 0), 0),
    };

    return {
      partners: partnerStats,
      grandTotals,
    };
  } catch (error) {
    console.error('Error fetching consignment report:', error);
    return {
      partners: [],
      grandTotals: {
        totalPartners: 0,
        totalSales: 0,
        totalPaid: 0,
        totalDebt: 0,
        totalCommissions: 0,
        paidCommissions: 0,
        unpaidCommissions: 0,
        totalInventoryValue: 0,
        totalInventoryQuantity: 0,
        totalOrders: 0,
      },
    };
  }
}

