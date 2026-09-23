'use server';

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { hasPermission, requirePermission } from '@/lib/access';
import { channelSummary, DEFAULT_CHANNEL_NAME } from '@/lib/consignment-channels';

/** Amounts at sell price and commissions for sales.view; inventory value at cost only with cost.view. */
export async function getConsignmentReport() {
  await requirePermission('sales.view');
  const canSeeCost = await hasPermission('cost.view');
  try {
    // Get all consignment partners
    const partners = await prisma.warehouse.findMany({
      where: { isVirtual: true, customerId: { not: null } },
      include: {
        customer: { include: { channels: { orderBy: { sortOrder: 'asc' } } } },
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
        consignmentChannel: true,
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
  (order: any) => order.customerId === customerId
      );

      // Calculate totals
      const totalSales = partnerOrders.reduce(
  (sum: any, order: any) => sum + Number(order.totalAmount) - Number(order.discount || 0),
        0
      );

      const totalPaid = partnerOrders.reduce(
  (sum: any, order: any) => sum + Number(order.paidAmount || 0),
        0
      );

      const totalDebt = totalSales - totalPaid;

      // Calculate total commissions
      const totalCommissions = partnerOrders.reduce((sum: any, order: any) => {
        const orderCommissions = order.commissions || [];
        return (
          sum +
          orderCommissions.reduce(
            (s: any, c: any) => s + Number(c.commissionAmount),
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

      // The partner's totals split over its sale channels. An order's channel
      // is the one it was sold through, else the name snapshotted on its
      // commission; an order from before channels belongs under «پیش‌فرض».
      const channels = (partner.customer?.channels ?? []).map((channel: any) => ({
        id: channel.id as string,
        name: channel.name as string,
        commissionRate: Number(channel.commissionRate),
        isDefault: channel.isDefault as boolean,
        isActive: channel.isActive as boolean,
      }));
      type ChannelRow = {
        channel: string;
        commissionRate: number;
        grossSales: number;
        commissions: number;
        netSales: number;
        orderCount: number;
      };
      const byChannel = new Map<string, ChannelRow>();
      for (const order of partnerOrders as any[]) {
        const name =
          order.consignmentChannel?.name ?? order.commissions?.[0]?.channelName ?? DEFAULT_CHANNEL_NAME;
        const netSales = Number(order.totalAmount) - Number(order.discount || 0);
        const commission = (order.commissions || []).reduce(
          (s: any, c: any) => s + Number(c.commissionAmount),
          0,
        );
        // The commission row carries the gross it was taken from; an order
        // without one (a plain sale to the partner) is its own gross.
        const gross = order.commissions?.[0] ? Number(order.commissions[0].orderAmount) : netSales;
        const row = byChannel.get(name) ?? {
          channel: name,
          // The channel's rate today; for a channel that is gone, the rate the order was booked at.
          commissionRate:
            channels.find((channel: any) => channel.name === name)?.commissionRate ??
            (order.commissions?.[0] ? Number(order.commissions[0].commissionRate) : 0),
          grossSales: 0,
          commissions: 0,
          netSales: 0,
          orderCount: 0,
        };
        row.grossSales += gross;
        row.commissions += commission;
        row.netSales += netSales;
        row.orderCount += 1;
        byChannel.set(name, row);
      }
      const channelOrder = new Map<string, number>(
        channels.map((channel: any, index: number) => [channel.name as string, index]),
      );
      const channelBreakdown = [...byChannel.values()].sort(
        (a, b) =>
          (channelOrder.get(a.channel) ?? channels.length) -
            (channelOrder.get(b.channel) ?? channels.length) ||
          a.channel.localeCompare(b.channel, 'fa'),
      );

      // Calculate inventory value (at cost)
      const inventoryValue = canSeeCost
        ? partner.inventory.reduce((sum: any, inv: any) => {
            const costPrice = Number(inv.product.costPrice || 0);
            return sum + inv.quantity * costPrice;
          }, 0)
        : null;

      const inventoryQuantity = partner.inventory.reduce(
  (sum: any, inv: any) => sum + inv.quantity,
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
        channelSummary: channelSummary(channels),
        channelBreakdown,
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
        orders: partnerOrders.slice(0, 10).map((order: any) => ({
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
          items: order.items.map((item: any) => {
            const { costPrice, ...productWithoutCost } = item.product ?? {};
            return {
              ...item,
              product: item.product ? {
                ...(canSeeCost ? item.product : productWithoutCost),
                image: item.product.image ?? undefined,
                wooId: item.product.wooId ?? undefined,
                barcode: item.product.barcode ?? undefined,
              } : undefined,
            };
          }),
        })), // Last 10 orders
      };
    }).filter((p: any): p is NonNullable<typeof p> => p !== null);

    // Calculate grand totals
    const grandTotals = {
      totalPartners: partnerStats.length,
      totalSales: partnerStats.reduce((sum: any, p: any) => sum + (p?.totalSales || 0), 0),
      totalPaid: partnerStats.reduce((sum: any, p: any) => sum + (p?.totalPaid || 0), 0),
      totalDebt: partnerStats.reduce((sum: any, p: any) => sum + (p?.totalDebt || 0), 0),
      totalCommissions: partnerStats.reduce(
  (sum: any, p: any) => sum + (p?.totalCommissions || 0),
        0
      ),
      paidCommissions: partnerStats.reduce(
  (sum: any, p: any) => sum + (p?.paidCommissions || 0),
        0
      ),
      unpaidCommissions: partnerStats.reduce(
  (sum: any, p: any) => sum + (p?.unpaidCommissions || 0),
        0
      ),
      totalInventoryValue: canSeeCost
        ? partnerStats.reduce(
            (sum: any, p: any) => sum + (p?.inventoryValue || 0),
            0
          )
        : null,
      totalInventoryQuantity: partnerStats.reduce(
  (sum: any, p: any) => sum + (p?.inventoryQuantity || 0),
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
        totalInventoryValue: canSeeCost ? 0 : null,
        totalInventoryQuantity: 0,
        totalOrders: 0,
      },
    };
  }
}

