'use server';

import { prisma } from '@/lib/prisma';
import { formatJalaliDate } from '@/lib/date-utils';
import { requirePermission } from '@/lib/access';
import { SOLD_ORDER_STATUS } from '@/lib/order-status';
import { orderNet } from '@/lib/order-balance';
import { netLineSale } from '@/lib/product-sales';
import { tehranDay } from '@/lib/tehran-day';

interface DateRange {
  startDate?: Date;
  endDate?: Date;
}

export async function getSalesAnalytics(range?: DateRange) {
  await requirePermission('finance.view');
  const startDate = range?.startDate || new Date(new Date().setDate(new Date().getDate() - 90));
  const endDate = range?.endDate || new Date();

  try {
    // Get all orders in the date range
    const orders = await prisma.order.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        status: SOLD_ORDER_STATUS,
      },
      include: {
        items: {
          include: {
            product: true,
            // Units returned or exchanged away are not sold.
            returns: { select: { quantity: true } },
            exchanges: { select: { quantity: true } },
          },
        },
        customer: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Calculate key metrics. An order's revenue is what its customer pays for
    // it, after the discount (src/lib/order-balance.ts).
    const totalRevenue = orders.reduce((sum: any, order: any) => sum + orderNet(order), 0);
    const totalOrders = orders.length;
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Get previous period for comparison
    const previousStartDate = new Date(startDate);
    previousStartDate.setDate(previousStartDate.getDate() - (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    
    const previousOrders = await prisma.order.findMany({
      where: {
        createdAt: {
          gte: previousStartDate,
          lt: startDate,
        },
        status: SOLD_ORDER_STATUS,
      },
    });

    const previousRevenue = previousOrders.reduce((sum: any, order: any) => sum + orderNet(order), 0);
    const revenueGrowth = previousRevenue > 0 ? ((totalRevenue - previousRevenue) / previousRevenue) * 100 : 0;
    const ordersGrowth = previousOrders.length > 0 ? ((totalOrders - previousOrders.length) / previousOrders.length) * 100 : 0;

    // Sales by Tehran day
    const salesByDay = orders.reduce((acc: any, order: any) => {
      const date = tehranDay(order.createdAt);
      if (!acc[date]) {
        acc[date] = { date, revenue: 0, orders: 0 };
      }
      acc[date].revenue += orderNet(order);
      acc[date].orders += 1;
      return acc;
    }, {} as Record<string, { date: string; revenue: number; orders: number }>);

    const salesOverTime = Object.values(salesByDay).map((day: any) => ({
      date: day.date,
      dateFormatted: formatJalaliDate(new Date(day.date)),
      revenue: day.revenue,
      orders: day.orders,
    }));

    // Top products by revenue: units net of returns and exchanges, revenue net
    // of the order's discount too (src/lib/product-sales.ts).
    const sold = new Map<any, { units: number; revenue: number }>(
      orders.flatMap((order: any) => order.items.map((item: any) => [item, netLineSale(item, order)])),
    );
    const productSales = orders.flatMap((order: any) => order.items).reduce((acc: any, item: any) => {
      const productId = item.productId;
      if (!acc[productId]) {
        acc[productId] = {
          id: productId,
          name: item.product.name,
          quantity: 0,
          revenue: 0,
        };
      }
      acc[productId].quantity += sold.get(item)!.units;
      acc[productId].revenue += sold.get(item)!.revenue;
      return acc;
    }, {} as Record<string, { id: string; name: string; quantity: number; revenue: number }>);

    const topProducts = Object.values(productSales)
      .sort((a: any, b: any) => b.revenue - a.revenue)
      .slice(0, 10) as { id: string; name: string; quantity: number; revenue: number; }[];

    // Top customers
    const customerSales = orders.reduce((acc: any, order: any) => {
      const customerId = order.customerId || 'walk-in';
      const customerName = order.customer?.name || 'مشتری عمومی';
      if (!acc[customerId]) {
        acc[customerId] = {
          id: customerId,
          name: customerName,
          orders: 0,
          revenue: 0,
        };
      }
      acc[customerId].orders += 1;
      acc[customerId].revenue += orderNet(order);
      return acc;
    }, {} as Record<string, { id: string; name: string; orders: number; revenue: number }>);

    const topCustomers = Object.values(customerSales)
      .sort((a: any, b: any) => b.revenue - a.revenue)
      .slice(0, 10) as { id: string; name: string; orders: number; revenue: number; }[];

    // Sales by product type
    const salesByCategory = orders.flatMap((order: any) => order.items).reduce((acc: any, item: any) => {
      const type = item.product.productType;
      if (!acc[type]) {
        acc[type] = { type, revenue: 0, quantity: 0 };
      }
      acc[type].revenue += sold.get(item)!.revenue;
      acc[type].quantity += sold.get(item)!.units;
      return acc;
    }, {} as Record<string, { type: string; revenue: number; quantity: number }>);

    const categoryDistribution = Object.values(salesByCategory) as { type: string; revenue: number; quantity: number; }[];

    // Simple linear regression for forecasting
    const forecast = calculateForecast(salesOverTime);

    return {
      summary: {
        totalRevenue,
        totalOrders,
        averageOrderValue,
        revenueGrowth,
        ordersGrowth,
      },
      salesOverTime,
      topProducts,
      topCustomers,
      categoryDistribution,
      forecast,
    };
  } catch (error) {
    console.error('Error fetching sales analytics:', error);
    throw new Error('Failed to fetch sales analytics');
  }
}

function calculateForecast(salesData: Array<{ date: string; revenue: number; orders: number }>) {
  if (salesData.length < 7) {
    return [];
  }

  // Simple moving average for next 7 days
  const lastSevenDays = salesData.slice(-7);
  const avgRevenue = lastSevenDays.reduce((sum: any, day: any) => sum + day.revenue, 0) / 7;
  const avgOrders = lastSevenDays.reduce((sum: any, day: any) => sum + day.orders, 0) / 7;

  const forecast = [];
  const lastDate = new Date(salesData[salesData.length - 1].date);

  for (let i = 1; i <= 7; i++) {
    const forecastDate = new Date(lastDate);
    forecastDate.setDate(forecastDate.getDate() + i);
    
    // Add some trend if revenue is growing
    const trend = salesData.length > 14 
      ? (lastSevenDays[6].revenue - lastSevenDays[0].revenue) / 7
      : 0;

    forecast.push({
      date: forecastDate.toISOString().split('T')[0],
      dateFormatted: formatJalaliDate(forecastDate),
      revenue: Math.round(avgRevenue + (trend * i)),
      orders: Math.round(avgOrders),
      isForecast: true,
    });
  }

  return forecast;
}

