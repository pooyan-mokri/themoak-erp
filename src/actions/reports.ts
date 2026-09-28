'use server';

import { prisma } from '@/lib/prisma';
import { TransactionType } from '@prisma/client';
import { requirePermission } from '@/lib/access';
import { orderNet } from '@/lib/order-balance';
import { SALE_LINE_INCLUDE, netLineSale } from '@/lib/product-sales';
import { cashPosition, customerReceivables, latestRates, supplierPositions } from '@/lib/money-totals';
import { profitEntry } from '@/lib/profit-rows';
import { tehranDay } from '@/lib/tehran-day';
import { STOCK_TYPES } from '@/lib/stock-levels';

// Financial Reports

/**
 * Profit & Loss Report
 * Revenue − cost of goods sold − operating expenses, over a period
 * (src/lib/profit-rows.ts). Money turned into stock (supplier payments,
 * arrival costs) is not a cost until the goods are sold: it reaches the P&L as
 * their COGS rows.
 */
export async function getProfitLossReport(startDate: Date, endDate: Date) {
  await requirePermission('profit.view');
  try {
    const rows = await prisma.transaction.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        type: true,
        amountInToman: true,
        amount: true,
        currency: true,
        category: true,
        date: true,
        exchangeGroupId: true,
        transferGroupId: true,
        LoanPayment: { select: { interest: true } },
      },
    });

    let income = 0;
    let cogs = 0;
    let operatingExpenses = 0;
    const incomeByCategory: Record<string, number> = {};
    const expensesByCategory: Record<string, number> = {};
    const monthlyData: Record<string, { income: number; cogs: number; expenses: number; profit: number }> = {};

    for (const t of rows as any[]) {
      const entry = profitEntry(t);
      if (!entry) continue;
      const { line, amount, category } = entry;
      const monthKey = tehranDay(t.date).substring(0, 7); // YYYY-MM, in Tehran
      const month = (monthlyData[monthKey] ??= { income: 0, cogs: 0, expenses: 0, profit: 0 });

      if (line === 'revenue') {
        income += amount;
        incomeByCategory[category] = (incomeByCategory[category] || 0) + amount;
        month.income += amount;
      } else {
        if (line === 'cogs') {
          cogs += amount;
          month.cogs += amount;
        } else {
          operatingExpenses += amount;
          expensesByCategory[category] = (expensesByCategory[category] || 0) + amount;
        }
        // The month's costs: what was sold at cost, and everything spent.
        month.expenses += amount;
      }
      month.profit = month.income - month.expenses;
    }

    const grossProfit = income - cogs;
    const expenses = cogs + operatingExpenses;
    const netProfit = income - expenses;

    return {
      summary: {
        income,
        cogs,
        grossProfit,
        operatingExpenses,
        expenses,
        netProfit,
        profitMargin: income > 0 ? (netProfit / income) * 100 : 0,
      },
      incomeByCategory,
      expensesByCategory,
      monthlyTrend: Object.entries(monthlyData).map(([month, data]) => ({
        month,
        ...data,
      })).sort((a: any, b: any) => a.month.localeCompare(b.month)),
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
  await requirePermission('profit.view');
  try {
    // Assets
    // Every account that holds money, foreign ones at the latest rate, as the
    // dashboard's «موجودی کل» (src/lib/money-totals.ts).
    const cashAccounts = await prisma.account.findMany({
      where: {
        type: { not: 'EXPENSE' },
      },
      select: {
        type: true,
        balance: true,
        currency: true,
      },
    });

    const rates = await latestRates(prisma);
    const balances = cashPosition(cashAccounts, rates);
    const totalCash = balances.total;

    // Purchase orders: owed for goods received and not yet paid, and paid for
    // goods not yet received (src/lib/money-totals.ts). An order only placed
    // is a commitment and is on neither side.
    const suppliers = await supplierPositions(prisma, rates);

    // Inventory Value (cost price * quantity) of the stock product types
    // (src/lib/stock-levels.ts, as on every stock screen) — split own vs. consignment
    const inventory = await prisma.inventory.findMany({
      where: { product: { productType: { in: [...STOCK_TYPES] } } },
      include: {
        product: { select: { costPrice: true } },
        warehouse: { select: { isVirtual: true } },
      },
    });

    let inventoryValue = 0;
    let consignmentInventoryValue = 0;
    inventory.forEach((item: any) => {
      const v = item.quantity * Number(item.product.costPrice);
      if (item.warehouse?.isVirtual) consignmentInventoryValue += v;
      else inventoryValue += v;
    });

    // Accounts Receivable: what customers still owe on their orders, invoiced
    // or not, the dashboard's «مطالبات» (src/lib/money-totals.ts).
    const accountsReceivable = await customerReceivables(prisma);

    const totalAssets =
      totalCash + inventoryValue + consignmentInventoryValue + accountsReceivable + suppliers.prepaid;

    // Liabilities: what is still owed to suppliers
    const accountsPayable = suppliers.payables;

    const totalLiabilities = accountsPayable;

    // Equity
    const totalEquity = totalAssets - totalLiabilities;

    return {
      assets: {
        cash: totalCash,
        cashByType: balances.byType,
        foreignCash: balances.foreign,
        unpricedCash: balances.unpriced,
        inventory: inventoryValue,
        consignmentInventory: consignmentInventoryValue,
        accountsReceivable,
        prepaidPurchases: suppliers.prepaid,
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
  await requirePermission('sales.view');
  try {
    // Units net of returns and exchanges, revenue net of the order's discount
    // too (src/lib/product-sales.ts), as on the product pages.
    const orders = await prisma.order.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        status: { not: 'CANCELLED' },
      },
      select: {
        discount: true,
        items: { include: { product: { select: { name: true, sku: true } }, ...SALE_LINE_INCLUDE } },
      },
    });

    const productSales: Record<string, { name: string; quantity: number; revenue: number }> = {};

    orders.forEach((order: any) => order.items.forEach((item: any) => {
      const key = item.productId;
      if (!productSales[key]) {
        productSales[key] = {
          name: item.product.name,
          quantity: 0,
          revenue: 0,
        };
      }
      const sold = netLineSale(item, order);
      productSales[key].quantity += sold.units;
      productSales[key].revenue += sold.revenue;
    }));

    return Object.values(productSales).sort((a: any, b: any) => b.revenue - a.revenue);
  } catch (error) {
    console.error('Error generating sales by product report:', error);
    throw new Error('Failed to generate sales by product report');
  }
}

export async function getSalesByCustomer(startDate: Date, endDate: Date) {
  await requirePermission('sales.view');
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

    orders.forEach((order: any) => {
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
      // What the customer pays for it, after the discount (src/lib/order-balance.ts).
      customerSales[key].revenue += orderNet(order);
    });

    return Object.values(customerSales).sort((a: any, b: any) => b.revenue - a.revenue);
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
  await requirePermission('sales.view');
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
        discount: true,
        wooId: true,
        siteReference: true,
      },
    });

    const salesByPeriod: Record<string, { revenue: number; orders: number }> = {};

    orders.forEach((order: any) => {
      let periodKey: string;
      
      if (interval === 'day') {
        periodKey = tehranDay(order.createdAt); // YYYY-MM-DD, in Tehran
      } else if (interval === 'week') {
        // Simple week grouping by ISO week
        const date = order.createdAt;
        const onejan = new Date(date.getFullYear(), 0, 1);
        const week = Math.ceil(((date.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
        periodKey = `${date.getFullYear()}-W${week.toString().padStart(2, '0')}`;
      } else {
        periodKey = tehranDay(order.createdAt).substring(0, 7); // YYYY-MM, in Tehran
      }

      if (!salesByPeriod[periodKey]) {
        salesByPeriod[periodKey] = {revenue: 0, orders: 0 };
      }
      salesByPeriod[periodKey].revenue += orderNet(order);
      salesByPeriod[periodKey].orders += 1;
    });

    return Object.entries(salesByPeriod)
      .map(([period, data]) => ({
        period,
        ...data,
      }))
      .sort((a: any, b: any) => a.period.localeCompare(b.period));
  } catch (error) {
    console.error('Error generating sales over time report:', error);
    throw new Error('Failed to generate sales over time report');
  }
}

/**
 * Inventory Reports
 */

export async function getStockTurnoverReport() {
  await requirePermission('cost.view');
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
    orderItems.forEach((item: any) => {
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
    currentInventory.forEach((inv: any) => {
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

    return Object.values(productTurnover).sort((a: any, b: any) => b.turnoverRate - a.turnoverRate);
  } catch (error) {
    console.error('Error generating stock turnover report:', error);
    throw new Error('Failed to generate stock turnover report');
  }
}

export async function getInventoryAgingReport() {
  await requirePermission('cost.view');
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
    const agingData = products.map((product: any) => {
      const daysInStock = Math.floor(
        (now.getTime() - product.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      const totalQuantity = product.inventory.reduce((sum: any, inv: any) => sum + inv.quantity, 0);
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

    return agingData.sort((a: any, b: any) => b.daysInStock - a.daysInStock);
  } catch (error) {
    console.error('Error generating inventory aging report:', error);
    throw new Error('Failed to generate inventory aging report');
  }
}
