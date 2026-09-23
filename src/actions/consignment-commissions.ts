'use server';

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { requirePermission } from '@/lib/access';
import { consignmentAmounts } from '@/lib/return-math';
import { DEFAULT_CHANNEL_NAME } from '@/lib/consignment-channels';

/**
 * "طلب از همکار" — outstanding NET amount partners owe us. Partners deduct
 * their commission before paying, so what we are owed per order is
 * (gross − commission − paid). Derived from non-cancelled, not-fully-paid
 * consignment orders (not from the commission table, which is now booked as
 * an expense at creation time).
 */
export async function getConsignmentCommissionsReport() {
  await requirePermission('sales.view');
  try {
    const orders = await prisma.order.findMany({
      where: {
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        status: { not: 'CANCELLED' },
        customer: { warehouses: { some: { isVirtual: true } } },
      },
      include: {
        customer: true,
        items: { include: { returns: true, exchanges: true } },
        commissions: true,
        consignmentChannel: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    type ChannelTotal = {
      channel: string;
      commissionRate: number;
      orderCount: number;
      orderAmount: number; // gross sold through the channel
      commissionAmount: number; // outstanding, as on the rows
    };
    const customerTotals: Record<string, {
      customer: any;
      totalCommission: number; // repurposed: total outstanding (our net owed)
      totalOrders: number;
      commissions: any[];
      channels: Map<string, ChannelTotal>;
    }> = {};

    let totalRows = 0;
    for (const order of orders) {
      const customerId = order.customerId as string;
      if (!customerId) continue;

      // Counted over the units still sold, as in the settlement list.
      const { grossAmount: gross, remainingAmount: outstanding } = consignmentAmounts(order);
      if (outstanding <= 0.01) continue;

      if (!customerTotals[customerId]) {
        customerTotals[customerId] = {
          customer: order.customer,
          totalCommission: 0,
          totalOrders: 0,
          commissions: [],
          channels: new Map(),
        };
      }
      // The channel the order was sold through, else the name snapshotted on
      // its commission; an order from before channels reads as «پیش‌فرض».
      const channel =
        (order as any).consignmentChannel?.name ??
        order.commissions?.[0]?.channelName ??
        DEFAULT_CHANNEL_NAME;
      const commissionRate = order.commissions?.[0]
        ? Number(order.commissions[0].commissionRate)
        : 0;
      customerTotals[customerId].totalCommission += outstanding;
      customerTotals[customerId].totalOrders += 1;
      customerTotals[customerId].commissions.push({
        id: order.id,
        orderNumber: order.number,
        orderAmount: gross,
        commissionRate,
        channelName: channel,
        commissionAmount: outstanding, // shown as "مبلغ طلب"
        createdAt: order.createdAt,
      });
      const channelTotal = customerTotals[customerId].channels.get(channel) ?? {
        channel,
        commissionRate,
        orderCount: 0,
        orderAmount: 0,
        commissionAmount: 0,
      };
      channelTotal.orderCount += 1;
      channelTotal.orderAmount += gross;
      channelTotal.commissionAmount += outstanding;
      customerTotals[customerId].channels.set(channel, channelTotal);
      totalRows++;
    }

    const report = Object.values(customerTotals)
      .map(({ channels, ...item }: any) => ({
        ...item,
        customer: item.customer
          ? {
              ...item.customer,
              phone: item.customer.phone ?? undefined,
              email: item.customer.email ?? undefined,
              address: item.customer.address ?? undefined,
              notes: item.customer.notes ?? undefined,
              wooId: item.customer.wooId ?? undefined,
              taxId: item.customer.taxId ?? undefined,
              segment: item.customer.segment ?? undefined,
            }
          : undefined,
        commissions: item.commissions.sort(
          (a: any, b: any) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
        channelTotals: [...channels.values()].sort(
          (a: any, b: any) => b.commissionAmount - a.commissionAmount,
        ),
      }))
      .sort((a: any, b: any) => b.totalCommission - a.totalCommission);

    const grandTotal = report.reduce(
      (sum: any, item: any) => sum + item.totalCommission,
      0,
    );

    return {
      report,
      grandTotal,
      totalPartners: report.length,
      totalUnpaidCommissions: totalRows,
    };
  } catch (error) {
    console.error('Error fetching consignment outstanding report:', error);
    return {
      report: [],
      grandTotal: 0,
      totalPartners: 0,
      totalUnpaidCommissions: 0,
    };
  }
}





