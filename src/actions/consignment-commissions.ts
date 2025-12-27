'use server';

import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export async function getConsignmentCommissionsReport() {
  try {
    // Get all unpaid commissions grouped by customer
    const unpaidCommissions = await prisma.consignmentCommission.findMany({
      where: {
        isPaid: false,
      },
      include: {
        customer: true,
        order: {
          include: {
            items: {
              include: {
                product: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Group by customer and calculate totals
    const customerTotals: Record<string, {
      customer: any;
      totalCommission: number;
      totalOrders: number;
      commissions: any[];
    }> = {};

    unpaidCommissions.forEach((commission) => {
      const customerId = commission.customerId;
      if (!customerTotals[customerId]) {
        customerTotals[customerId] = {
          customer: commission.customer,
          totalCommission: 0,
          totalOrders: 0,
          commissions: [],
        };
      }

      const commissionAmount = Number(commission.commissionAmount);
      customerTotals[customerId].totalCommission += commissionAmount;
      customerTotals[customerId].totalOrders += 1;
      customerTotals[customerId].commissions.push({
        id: commission.id,
        orderNumber: commission.order.number,
        orderAmount: Number(commission.orderAmount),
        commissionRate: Number(commission.commissionRate),
        commissionAmount,
        createdAt: commission.createdAt,
        order: commission.order,
      });
    });

    // Convert to array and sort by total commission (descending)
    const report = Object.values(customerTotals)
      .map((item) => ({
        ...item,
        customer: item.customer ? {
          ...item.customer,
          phone: item.customer.phone ?? undefined,
          email: item.customer.email ?? undefined,
          address: item.customer.address ?? undefined,
          notes: item.customer.notes ?? undefined,
          wooId: item.customer.wooId ?? undefined,
          taxId: item.customer.taxId ?? undefined,
          segment: item.customer.segment ?? undefined,
        } : undefined,
        commissions: item.commissions.map((comm) => ({
          ...comm,
          order: comm.order ? {
            ...comm.order,
            discount: comm.order.discount ? Number(comm.order.discount) : undefined,
            paidAmount: comm.order.paidAmount ? Number(comm.order.paidAmount) : undefined,
            customerId: comm.order.customerId ?? undefined,
          } : undefined,
        })).sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        ),
      }))
      .sort((a, b) => b.totalCommission - a.totalCommission);

    // Calculate grand total
    const grandTotal = report.reduce((sum, item) => sum + item.totalCommission, 0);

    return {
      report,
      grandTotal,
      totalPartners: report.length,
      totalUnpaidCommissions: unpaidCommissions.length,
    };
  } catch (error) {
    console.error('Error fetching consignment commissions report:', error);
    return {
      report: [],
      grandTotal: 0,
      totalPartners: 0,
      totalUnpaidCommissions: 0,
    };
  }
}

export async function markCommissionAsPaid(commissionId: string) {
  try {
    await prisma.consignmentCommission.update({
      where: { id: commissionId },
      data: {
        isPaid: true,
        paidDate: new Date(),
      },
    });
    return { success: true, message: 'کمیسیون به عنوان پرداخت شده علامت‌گذاری شد.' };
  } catch (error: any) {
    return { success: false, message: error.message || 'خطا در بروزرسانی کمیسیون.' };
  }
}

export async function payAllCommissionsForCustomer(customerId: string) {
  try {
    const result = await prisma.consignmentCommission.updateMany({
      where: {
        customerId,
        isPaid: false,
      },
      data: {
        isPaid: true,
        paidDate: new Date(),
      },
    });
    return { 
      success: true, 
      message: `${result.count} کمیسیون به عنوان پرداخت شده علامت‌گذاری شد.`,
      count: result.count,
    };
  } catch (error: any) {
    return { success: false, message: error.message || 'خطا در بروزرسانی کمیسیون‌ها.' };
  }
}



