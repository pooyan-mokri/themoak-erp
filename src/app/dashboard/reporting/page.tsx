
import { getBalanceSheet, getProfitAndLoss, getSalesPerformance, getSalesByCustomer, getInventoryValuation } from '@/actions/reporting';
import { getSalesByProduct, getExpenseBreakdown } from '@/actions/accounting';
import { BalanceSheetCard } from '@/components/reporting/balance-sheet-card';
import { ProfitLossCard } from '@/components/reporting/profit-loss-card';
import { SalesChart } from '@/components/reporting/sales-chart';
import { SalesByProduct } from '@/components/reporting/sales-by-product';
import { ExpenseBreakdown } from '@/components/reporting/expense-breakdown';
import { SalesByCustomer } from '@/components/reporting/sales-by-customer';
import { InventoryValuation } from '@/components/reporting/inventory-valuation';

export default async function ReportingPage() {
  const profitLossData = await getProfitAndLoss();
  const balanceSheetData = await getBalanceSheet();
  const salesData = await getSalesPerformance();
  const salesByProductData = await getSalesByProduct();
  const expenseBreakdownData = await getExpenseBreakdown();
  const salesByCustomerData = await getSalesByCustomer();
  const inventoryValuationData = await getInventoryValuation();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">گزارشات مالی</h1>
      
      <ProfitLossCard data={profitLossData} />
      
      <div className="grid gap-6 md:grid-cols-3">
        <BalanceSheetCard data={balanceSheetData} />
        <SalesChart data={salesData} />
        <ExpenseBreakdown data={expenseBreakdownData} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <SalesByProduct data={salesByProductData} />
        <SalesByCustomer data={salesByCustomerData} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <InventoryValuation data={inventoryValuationData} />
      </div>
    </div>
  );
}
