'use server';

import { prisma } from '@/lib/prisma';
import { TransactionType } from '@prisma/client';

// Financial Reports

/**
 * Profit & Loss Report
 * Shows Income vs Expenses over a period
 */
export async function getProfitLossReport(startDate: Date, endDate: Date) {
  try {
    const transactions = await prisma.transaction.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        type: true,
        amountInToman: true,
        category: true,
        date: true,
      },
    });

    const income = transactions
      .filter(t => t.type === 'INCOME')
      .reduce((sum, t) => sum + Number(t.amountInToman), 0);

    const expenses = transactions
      .filter(t => t.type === 'EXPENSE')
      .reduce((sum, t) => sum + Number(t.amountInToman), 0);

    const netProfit = income - expenses;

    // Group by category
    const incomeByCategory: Record<string, number> = {};
    const expensesByCategory: Record<string, number> = {};

    transactions.forEach(t => {
      const category = t.category || 'سایر';
      const amount = Number(t.amountInToman);

      if (t.type === 'INCOME') {
        incomeByCategory[category] = (incomeByCategory[category] || 0) + amount;
      } else if (t.type === 'EXPENSE') {
        expensesByCategory[category] = (expensesByCategory[category] || 0) + amount;
      }
    });

    // Monthly breakdown
    const monthlyData: Record<string, { income: number; expenses: number; profit: number }> = {};
    
    transactions.forEach(t => {
      const monthKey = t.date.toISOString().substring(0, 7); // YYYY-MM
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { income: 0, expenses: 0, profit: 0 };
      }

      const amount = Number(t.amountInToman);
      if (t.type === 'INCOME') {
        monthlyData[monthKey].income += amount;
      } else if (t.type === 'EXPENSE') {
        monthlyData[monthKey].expenses += amount;
      }
      monthlyData[monthKey].profit = monthlyData[monthKey].income - monthlyData[monthKey].expenses;
    });

    return {
      summary: {
        income,
        expenses,
        netProfit,
        profitMargin: income > 0 ? (netProfit / income) * 100 : 0,
      },
      incomeByCategory,
      expensesByCategory,
      monthlyTrend: Object.entries(monthlyData).map(([month, data]) => ({
        month,
        ...data,
      })).sort((a, b) => a.month.localeCompare(b.month)),
    };
  } catch (error) {
    console.error('Error generating P&L report:', error);
    throw new Error('Failed to generate Profit & Loss report');
  }
}

/**
 * Balance Sheet
 * Shows current financial position: Assets vs Liabilities
 */
export async function getBalanceSheet(date: Date) {
  try {
    // Assets
    const cashAccounts = await prisma.account.findMany({
      where: {
        type: { in: ['Cash', 'Bank'] },
      },
      select: {
        balance: true,
      },
    });

    const totalCash = cashAccounts.reduce((sum, acc) => sum + Number(acc.balance), 0);

    // Inventory Value (cost price * quantity)
    const inventory = await prisma.inventory.findMany({
      include: {
        product: {
          select: {
            costPrice: true,
          },
        },
      },
    });

    const inventoryValue = inventory.reduce(
      (sum, item) => sum + item.quantity * Number(item.product.costPrice),
      0
    );

    // Accounts Receivable (unpaid invoices)
    const unpaidInvoices = await prisma.invoice.findMany({
      where: {
        status: { in: ['UNPAID', 'PARTIAL'] },
      },
      select: {
        total: true,
        paidAmount: true,
      },
    });

    const accountsReceivable = unpaidInvoices.reduce(
      (sum, inv) => sum + (Number(inv.total) - Number(inv.paidAmount)),
      0
    );

    const totalAssets = totalCash + inventoryValue + accountsReceivable;

    // Liabilities (for now, simplified - we don't track AP yet)
    const accountsPayable = 0; // TODO: implement when we add bills/payables

    const totalLiabilities = accountsPayable;

    // Equity
    const totalEquity = totalAssets - totalLiabilities;

    return {
      assets: {
        cash: totalCash,
        inventory: inventoryValue,
        accountsReceivable,
        total: totalAssets,
      },
      liabilities: {
        accountsPayable,
        total: totalLiabilities,
      },
      equity: {
        total: totalEquity,
      },
    };
  } catch (error) {
    console.error('Error generating balance sheet:', error);
    throw new Error('Failed to generate balance sheet');
  }
}

/**
 * Sales Reports
 */

export async function getSalesByProduct(startDate: Date, endDate: Date) {
  try {
    const orderItems = await prisma.orderItem.findMany({
      where: {
        order: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
          status: { not: 'CANCELLED' },
        },
      },
      include: {
        product: {
          select: {
            name: true,
            sku: true,
          },
        },
      },
    });

    const productSales: Record<string, { name: string; quantity: number; revenue: number }> = {};

    orderItems.forEach(item => {
      const key = item.productId;
      if (!productSales[key]) {
        productSales[key] = {
          name: item.product.name,
          quantity: 0,
          revenue: 0,
        };
      }
      productSales[key].quantity += item.quantity;
      productSales[key].revenue += item.quantity * Number(item.price);
    });

    return Object.values(productSales).sort((a, b) => b.revenue - a.revenue);
  } catch (error) {
    console.error('Error generating sales by product report:', error);
    throw new Error('Failed to generate sales by product report');
  }
}

export async function getSalesByCustomer(startDate: Date, endDate: Date) {
  try {
    const orders = await prisma.order.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        status: { not: 'CANCELLED' },
      },
      include: {
        customer: {
          select: {
            name: true,
          },
        },
      },
    });

    const customerSales: Record<string, { name: string; orderCount: number; revenue: number }> = {};

    orders.forEach(order => {
      const key = order.customerId || 'walk-in';
      const name = order.customer?.name || 'مشتری حضوری';
      
      if (!customerSales[key]) {
        customerSales[key] = {
          name,
          orderCount: 0,
          revenue: 0,
        };
      }
      customerSales[key].orderCount += 1;
      customerSales[key].revenue += Number(order.totalAmount);
    });

    return Object.values(customerSales).sort((a, b) => b.revenue - a.revenue);
  } catch (error) {
    console.error('Error generating sales by customer report:', error);
    throw new Error('Failed to generate sales by customer report');
  }
}

export async function getSalesOverTime(
  startDate: Date,
  endDate: Date,
  interval: 'day' | 'week' | 'month' = 'month'
) {
  try {
    const orders = await prisma.order.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        status: { not: 'CANCELLED' },
      },
      select: {
        createdAt: true,
        totalAmount: true,
      },
    });

    const salesByPeriod: Record<string, { revenue: number; orders: number }> = {};

    orders.forEach(order => {
      let periodKey: string;
      
      if (interval === 'day') {
        periodKey = order.createdAt.toISOString().substring(0, 10); // YYYY-MM-DD
      } else if (interval === 'week') {
        // Simple week grouping by ISO week
        const date = order.createdAt;
        const onejan = new Date(date.getFullYear(), 0, 1);
        const week = Math.ceil(((date.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
        periodKey = `${date.getFullYear()}-W${week.toString().padStart(2, '0')}`;
      } else {
        periodKey = order.createdAt.toISOString().substring(0, 7); // YYYY-MM
      }

      if (!salesByPeriod[periodKey]) {
        salesByPeriod[periodKey] = {revenue: 0, orders: 0 };
      }
      salesByPeriod[periodKey].revenue += Number(order.totalAmount);
      salesByPeriod[periodKey].orders += 1;
    });

    return Object.entries(salesByPeriod)
      .map(([period, data]) => ({
        period,
        ...data,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));
  } catch (error) {
    console.error('Error generating sales over time report:', error);
    throw new Error('Failed to generate sales over time report');
  }
}

/**
 * Inventory Reports
 */

export async function getStockTurnoverReport() {
  try {
    // Stock turnover = Cost of Goods Sold / Average Inventory Value
    // For simplicity, we'll calculate based on sales in last 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const orderItems = await prisma.orderItem.findMany({
      where: {
        order: {
          createdAt: {
            gte: ninetyDaysAgo,
          },
          status: { not: 'CANCELLED' },
        },
      },
      include: {
        product: {
          select: {
            name: true,
            costPrice: true,
          },
        },
      },
    });

    const currentInventory = await prisma.inventory.findMany({
      include: {
        product: {
          select: {
            name: true,
            costPrice: true,
          },
        },
      },
    });

    const productTurnover: Record<string, { 
      name: string; 
      soldQuantity: number; 
      currentStock: number;
      turnoverRate: number;
    }> = {};

    // Calculate sold quantity
    orderItems.forEach(item => {
      const key = item.productId;
      if (!productTurnover[key]) {
        productTurnover[key] = {
          name: item.product.name,
          soldQuantity: 0,
          currentStock: 0,
          turnoverRate: 0,
        };
      }
      productTurnover[key].soldQuantity += item.quantity;
    });

    // Add current stock
    currentInventory.forEach(inv => {
      const key = inv.productId;
      if (!productTurnover[key]) {
        productTurnover[key] = {
          name: inv.product.name,
          soldQuantity: 0,
          currentStock: 0,
          turnoverRate: 0,
        };
      }
      productTurnover[key].currentStock += inv.quantity;
    });

    // Calculate turnover rate (times per 90 days)
    Object.values(productTurnover).forEach(product => {
      if (product.currentStock > 0) {
        product.turnoverRate = product.soldQuantity / product.currentStock;
      }
    });

    return Object.values(productTurnover).sort((a, b) => b.turnoverRate - a.turnoverRate);
  } catch (error) {
    console.error('Error generating stock turnover report:', error);
    throw new Error('Failed to generate stock turnover report');
  }
}

export async function getInventoryAgingReport() {
  try {
    // This would ideally track when each inventory item was received
    // For now, we'll use product creation date as a proxy
    const products = await prisma.product.findMany({
      include: {
        inventory: {
          select: {
            quantity: true,
            warehouse: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    const now = new Date();
    const agingData = products.map(product => {
      const daysInStock = Math.floor(
        (now.getTime() - product.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      const totalQuantity = product.inventory.reduce((sum, inv) => sum + inv.quantity, 0);
      const value = totalQuantity * Number(product.costPrice);

      return {
        name: product.name,
        sku: product.sku,
        quantity: totalQuantity,
        value,
        daysInStock,
        category: daysInStock > 180 ? 'بیش از 180 روز' : daysInStock > 90 ? '90-180 روز' : 'کمتر از 90 روز',
      };
    });

    return agingData.sort((a, b) => b.daysInStock - a.daysInStock);
  } catch (error) {
    console.error('Error generating inventory aging report:', error);
    throw new Error('Failed to generate inventory aging report');
  }
}
