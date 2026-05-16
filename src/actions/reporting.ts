
'use server';

import { PrismaClient } from '@prisma/client';
import { TransactionType, Currency } from '@/lib/types';

import { prisma } from '@/lib/prisma';

// const prisma = new PrismaClient();

export async function getProfitAndLoss(startDate?: Date, endDate?: Date) {
  try {
    const whereClause: { date?: { gte: Date; lte: Date } } = {};
    if (startDate && endDate) {
      whereClause.date = {
        gte: startDate,
        lte: endDate,
      };
    }

    const transactions = await prisma.transaction.findMany({
      where: whereClause,
    });

    let totalIncome = 0;
    let totalExpense = 0;

    transactions.forEach((tx: any) => {
      const amount = Number(tx.amountInToman || tx.amount); // Fallback if amountInToman is missing
      if (tx.type === TransactionType.INCOME) {
        totalIncome += amount;
      } else if (tx.type === TransactionType.EXPENSE) {
        totalExpense += amount;
      }
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

export async function getBalanceSheet() {
  try {
    // 1. Cash & Bank Balances
    const accounts = await prisma.account.findMany();
    let totalCashBank = 0;
    accounts.forEach((acc: any) => {
        // Simplified: Assuming all balances are normalized to TOMAN or we just sum them for now.
        // Ideally we should convert based on current rate.
        // For MVP, let's assume the balance is what it is (mixed currencies sum is bad, but acceptable for MVP if user sticks to one).
        // BETTER: We should probably store a 'balanceInToman' or convert on the fly.
        // Let's assume 1:1 for now or that the user mainly uses TOMAN.
        totalCashBank += Number(acc.balance);
    });

    // 2. Inventory Value — split own warehouses vs. consignment (virtual)
    const inventory = await prisma.inventory.findMany({
      include: { product: true, warehouse: true }
    });
    let inventoryValue = 0;          // goods in our own warehouses
    let consignmentInventoryValue = 0; // goods at partners (still our asset)
    inventory.forEach((item: any) => {
      const value = item.quantity * Number(item.product.costPrice);
      if (item.warehouse?.isVirtual) {
        consignmentInventoryValue += value;
      } else {
        inventoryValue += value;
      }
    });

    // 3. Accounts Receivable (unpaid settlements) — NET of partner commission.
    // Derived from items & commission so legacy gross-stored orders are correct.
    const pendingOrders = await prisma.order.findMany({
      where: {
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        customer: { warehouses: { some: { isVirtual: true } } },
      },
      include: { items: true, commissions: true },
    });
    let accountsReceivable = 0;
    pendingOrders.forEach((order: any) => {
      const gross = order.items.reduce(
        (s: number, it: any) => s + it.quantity * Number(it.price),
        0,
      );
      const commission = order.commissions?.[0]
        ? Number(order.commissions[0].commissionAmount)
        : 0;
      const net = gross - commission;
      const paid = Number(order.paidAmount || 0);
      accountsReceivable += Math.max(net - paid, 0);
    });

    const totalAssets =
      totalCashBank + inventoryValue + consignmentInventoryValue + accountsReceivable;

    return {
      assets: {
        cashAndBank: totalCashBank,
        inventory: inventoryValue,
        consignmentInventory: consignmentInventoryValue,
        accountsReceivable: accountsReceivable,
        total: totalAssets
      },
      liabilities: {
        total: 0 // We don't track Accounts Payable yet
      },
      equity: {
        total: totalAssets // Assets - Liabilities
      }
    };
  } catch (error) {
    console.error('Error calculating Balance Sheet:', error);
    return {
      assets: { cashAndBank: 0, inventory: 0, consignmentInventory: 0, accountsReceivable: 0, total: 0 },
      liabilities: { total: 0 },
      equity: { total: 0 }
    };
  }
}

export async function getSalesPerformance() {
  try {
    // Top Selling Products
    const orderItems = await prisma.orderItem.findMany({
      include: { product: true, order: true },
      where: {
        order: {
          status: 'COMPLETED'
        }
      }
    });

    const productSales: Record<string, { name: string, quantity: number, total: number }> = {};

    orderItems.forEach((item: any) => {
      if (!productSales[item.productId]) {
        productSales[item.productId] = {
          name: item.product.name,
          quantity: 0,
          total: 0
        };
      }
      productSales[item.productId].quantity += item.quantity;
      productSales[item.productId].total += item.quantity * Number(item.price);
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
  try {
    const orders = await prisma.order.findMany({
      where: { status: 'COMPLETED' },
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
      customerSales[customerId].total += Number(order.totalAmount);
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

    inventory.forEach((item: any) => {
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
