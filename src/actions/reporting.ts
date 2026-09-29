
'use server';

import { PrismaClient } from '@prisma/client';
import { Currency } from '@/lib/types';

import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/access';
import { SOLD_ORDER_STATUS } from '@/lib/order-status';
import { profitEntry } from '@/lib/profit-rows';
import { orderNet } from '@/lib/order-balance';
import { SALE_LINE_INCLUDE, netLineSale } from '@/lib/product-sales';
import { holdsStock } from '@/lib/stock-levels';
import { getBalanceSheet as getFinancialBalanceSheet } from '@/actions/reports';

// const prisma = new PrismaClient();

export async function getProfitAndLoss(startDate?: Date, endDate?: Date) {
  await requirePermission('profit.view');
  try {
    const whereClause: { date?: { gte: Date; lte: Date } } = {};
    if (startDate && endDate) {
      whereClause.date = {
        gte: startDate,
        lte: endDate,
      };
    }

    // The same rows and rule as the financial reports' P&L (src/lib/profit-rows.ts):
    // in Toman, capital, loans, exchanges and transfers left out, goods at their
    // cost of goods sold (stock bought is not an expense).
    const transactions = await prisma.transaction.findMany({
      where: whereClause,
      select: {
        type: true,
        amountInToman: true,
        amount: true,
        currency: true,
        category: true,
        exchangeGroupId: true,
        transferGroupId: true,
        LoanPayment: { select: { interest: true } },
      },
    });

    let totalIncome = 0;
    let totalExpense = 0;

    transactions.forEach((tx: any) => {
      const entry = profitEntry(tx);
      if (!entry) return;
      if (entry.line === 'revenue') totalIncome += entry.amount;
      else totalExpense += entry.amount;
    });

    return {
      totalIncome,
      totalExpense,
      netProfit: totalIncome - totalExpense,
    };
  } catch (error) {
    console.error('Error calculating P&L:', error);
    return { totalIncome: 0, totalExpense: 0, netProfit: 0 };
  }
}

/**
 * The financial reports' balance sheet (src/actions/reports.ts), in this
 * card's shape, so both pages show the same figures: every account in Toman,
 * stock of the stock product types at cost, what customers owe, prepaid
 * purchases, and what is owed to suppliers.
 */
export async function getBalanceSheet() {
  await requirePermission('profit.view');
  try {
    const sheet = await getFinancialBalanceSheet(new Date());
    return {
      assets: {
        cashAndBank: sheet.assets.cash,
        inventory: sheet.assets.inventory,
        consignmentInventory: sheet.assets.consignmentInventory,
        accountsReceivable: sheet.assets.accountsReceivable,
        prepaidPurchases: sheet.assets.prepaidPurchases,
        total: sheet.assets.total,
      },
      liabilities: {
        accountsPayable: sheet.liabilities.accountsPayable,
        total: sheet.liabilities.total,
      },
      equity: {
        total: sheet.equity.total,
      },
    };
  } catch (error) {
    console.error('Error calculating Balance Sheet:', error);
    return {
      assets: { cashAndBank: 0, inventory: 0, consignmentInventory: 0, accountsReceivable: 0, prepaidPurchases: 0, total: 0 },
      liabilities: { accountsPayable: 0, total: 0 },
      equity: { total: 0 }
    };
  }
}

export async function getSalesPerformance() {
  await requirePermission('sales.view');
  try {
    // Top Selling Products: units net of returns and exchanges, revenue net of
    // the order's discount too (src/lib/product-sales.ts), as on the product pages.
    const orders = await prisma.order.findMany({
      where: { status: SOLD_ORDER_STATUS },
      select: { discount: true, items: { include: { product: true, ...SALE_LINE_INCLUDE } } },
    });

    const productSales: Record<string, { name: string, quantity: number, total: number }> = {};

    orders.forEach((order: any) => {
      order.items.forEach((item: any) => {
        if (!productSales[item.productId]) {
          productSales[item.productId] = {
            name: item.product.name,
            quantity: 0,
            total: 0
          };
        }
        const sold = netLineSale(item, order);
        productSales[item.productId].quantity += sold.units;
        productSales[item.productId].total += sold.revenue;
      });
    });

    const topProducts = Object.values(productSales)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    return {
      topProducts
    };
  } catch (error) {
    console.error('Error calculating Sales Performance:', error);
    return { topProducts: [] };
  }
}

export async function getSalesByCustomer() {
  await requirePermission('sales.view');
  try {
    const orders = await prisma.order.findMany({
      where: { status: SOLD_ORDER_STATUS },
      include: { customer: true }
    });

    const customerSales: Record<string, { name: string, count: number, total: number }> = {};

    orders.forEach((order: any) => {
      const customerName = order.customer?.name || 'مشتری ناشناس';
      const customerId = order.customerId || 'unknown';

      if (!customerSales[customerId]) {
        customerSales[customerId] = {
          name: customerName,
          count: 0,
          total: 0
        };
      }
      customerSales[customerId].count += 1;
      // What the customer pays for it, after the discount (src/lib/order-balance.ts).
      customerSales[customerId].total += orderNet(order);
    });

    const topCustomers = Object.values(customerSales)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    return { topCustomers };
  } catch (error) {
    console.error('Error calculating Sales by Customer:', error);
    return { topCustomers: [] };
  }
}

export async function getInventoryValuation() {
  await requirePermission('cost.view');
  try {
    const inventory = await prisma.inventory.findMany({
      include: {
        product: true,
        warehouse: true
      }
    });

    let totalValue = 0;
    let ownValue = 0;
    let consignmentValue = 0;
    const warehouseValuation: Record<string, { name: string, value: number, itemCount: number, isVirtual: boolean }> = {};

    // Stock value counts the stock product types only (src/lib/stock-levels.ts).
    inventory.filter((item: any) => holdsStock(item.product.productType)).forEach((item: any) => {
      const itemValue = item.quantity * Number(item.product.costPrice);
      totalValue += itemValue;
      if (item.warehouse?.isVirtual) {
        consignmentValue += itemValue;
      } else {
        ownValue += itemValue;
      }

      if (!warehouseValuation[item.warehouseId]) {
        warehouseValuation[item.warehouseId] = {
          name: item.warehouse.name,
          value: 0,
          itemCount: 0,
          isVirtual: !!item.warehouse?.isVirtual
        };
      }
      warehouseValuation[item.warehouseId].value += itemValue;
      warehouseValuation[item.warehouseId].itemCount += item.quantity;
    });

    return {
      totalValue,
      ownValue,
      consignmentValue,
      byWarehouse: Object.values(warehouseValuation)
    };
  } catch (error) {
    console.error('Error calculating Inventory Valuation:', error);
    return { totalValue: 0, ownValue: 0, consignmentValue: 0, byWarehouse: [] };
  }
}
