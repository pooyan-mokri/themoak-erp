'use server';

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

/**
 * "طلب از همکار" — outstanding NET amount partners owe us. Partners deduct
 * their commission before paying, so what we are owed per order is
 * (gross − commission − paid). Derived from non-cancelled, not-fully-paid
 * consignment orders (not from the commission table, which is now booked as
 * an expense at creation time).
 */
export async function getConsignmentCommissionsReport() {
  try {
    const orders = await prisma.order.findMany({
      where: {
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        status: { not: 'CANCELLED' },
        customer: { warehouses: { some: { isVirtual: true } } },
      },
      include: {
        customer: true,
        items: true,
        commissions: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const customerTotals: Record<string, {
      customer: any;
      totalCommission: number; // repurposed: total outstanding (our net owed)
      totalOrders: number;
      commissions: any[];
    }> = {};

    let totalRows = 0;
    for (const order of orders) {
      const customerId = order.customerId as string;
      if (!customerId) continue;

      const gross = order.items.reduce(
        (s: number, it: any) => s + it.quantity * Number(it.price),
        0,
      );
      const commissionAmount = order.commissions?.[0]
        ? Number(order.commissions[0].commissionAmount)
        : 0;
      const net = gross - commissionAmount;
      const paid = Number(order.paidAmount || 0);
      const outstanding = net - paid;
      if (outstanding <= 0.01) continue;

      if (!customerTotals[customerId]) {
        customerTotals[customerId] = {
          customer: order.customer,
          totalCommission: 0,
          totalOrders: 0,
          commissions: [],
        };
      }
      customerTotals[customerId].totalCommission += outstanding;
      customerTotals[customerId].totalOrders += 1;
      customerTotals[customerId].commissions.push({
        id: order.id,
        orderNumber: order.number,
        orderAmount: gross,
        commissionRate: order.commissions?.[0]
          ? Number(order.commissions[0].commissionRate)
          : 0,
        commissionAmount: outstanding, // shown as "مبلغ طلب"
        createdAt: order.createdAt,
      });
      totalRows++;
    }

    const report = Object.values(customerTotals)
      .map((item: any) => ({
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





