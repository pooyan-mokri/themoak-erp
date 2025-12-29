'use server';

import { prisma } from '@/lib/prisma';
import { formatJalaliDate } from '@/lib/date-utils';

interface DateRange {
  startDate?: Date;
  endDate?: Date;
}

export async function getSalesAnalytics(range?: DateRange) {
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
        status: { in: ['COMPLETED', 'DELIVERED'] },
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        customer: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Calculate key metrics
    const totalRevenue = orders.reduce((sum: number, order) => sum + Number(order.totalAmount), 0);
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
        status: { in: ['COMPLETED', 'DELIVERED'] },
      },
    });

    const previousRevenue = previousOrders.reduce((sum: number, order) => sum + Number(order.totalAmount), 0);
    const revenueGrowth = previousRevenue > 0 ? ((totalRevenue - previousRevenue) / previousRevenue) * 100 : 0;
    const ordersGrowth = previousOrders.length > 0 ? ((totalOrders - previousOrders.length) / previousOrders.length) * 100 : 0;

    // Sales by day
    interface DailySales {
      date: string;
      revenue: number;
      orders: number;
    }

    const salesByDay = orders.reduce((acc: Record<string, DailySales>, order) => {
      const date = order.createdAt.toISOString().split('T')[0];
      if (!acc[date]) {
        acc[date] = { date, revenue: 0, orders: 0 };
      }
      acc[date].revenue += Number(order.totalAmount);
      acc[date].orders += 1;
      return acc;
    }, {} as Record<string, DailySales>);

    const salesOverTime = Object.values(salesByDay).map((day) => ({
      date: day.date,
      dateFormatted: formatJalaliDate(new Date(day.date)),
      revenue: day.revenue,
      orders: day.orders,
    }));

    // Top products by revenue
    interface ProductSales {
      id: string;
      name: string;
      quantity: number;
      revenue: number;
    }

    const productSales = orders.flatMap((order) => order.items).reduce((acc: Record<string, ProductSales>, item) => {
      const productId = item.productId;
      if (!acc[productId]) {
        acc[productId] = {
          id: productId,
          name: item.product.name,
          quantity: 0,
          revenue: 0,
        };
      }
      acc[productId].quantity += item.quantity;
      acc[productId].revenue += item.quantity * Number(item.price);
      return acc;
    }, {} as Record<string, ProductSales>);

    const topProducts = Object.values(productSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // Top customers
    interface CustomerSales {
      id: string;
      name: string;
      orders: number;
      revenue: number;
    }

    const customerSales = orders.reduce((acc: Record<string, CustomerSales>, order) => {
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
      acc[customerId].revenue += Number(order.totalAmount);
      return acc;
    }, {} as Record<string, CustomerSales>);

    const topCustomers = Object.values(customerSales)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // Sales by product type
    interface CategorySales {
      type: string;
      revenue: number;
      quantity: number;
    }

    const salesByCategory = orders.flatMap((order) => order.items).reduce((acc: Record<string, CategorySales>, item) => {
      const type = item.product.productType;
      if (!acc[type]) {
        acc[type] = { type, revenue: 0, quantity: 0 };
      }
      acc[type].revenue += item.quantity * Number(item.price);
      acc[type].quantity += item.quantity;
      return acc;
    }, {} as Record<string, CategorySales>);

    const categoryDistribution = Object.values(salesByCategory);

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
  const avgRevenue = lastSevenDays.reduce((sum: number, day) => sum + day.revenue, 0) / 7;
  const avgOrders = lastSevenDays.reduce((sum: number, day) => sum + day.orders, 0) / 7;

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

