import {
  getProductDetail,
  getProductStockBreakdown,
  getProductSalesAnalytics,
  getProductMovementHistory,
  getProductSalesHistory
} from '@/actions/product-detail';
import { ProductHeader } from '@/components/inventory/product-header';
import { StockKPICards } from '@/components/inventory/stock-kpi-cards';
import { FinancialKPICards } from '@/components/inventory/financial-kpi-cards';
import { StockBreakdownTable } from '@/components/inventory/stock-breakdown-table';
import { SalesAnalyticsCards } from '@/components/inventory/sales-analytics-cards';
import { ProductSalesChart } from '@/components/inventory/product-sales-chart';
import { MovementHistory } from '@/components/inventory/movement-history';
import { ProductBarcode } from '@/components/inventory/product-barcode';
import { notFound } from 'next/navigation';

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  try {
    // Fetch product first to check if it exists
    const productData = await getProductDetail(params.id);

    if (!productData) {
      notFound();
    }

    // TypeScript-safe: product is guaranteed to exist after notFound() check
    const product = productData;

    // Fetch other data in parallel (with error handling for each)
    const [stockBreakdown, salesAnalytics, movementHistory, salesHistory] = await Promise.allSettled([
      getProductStockBreakdown(params.id),
      getProductSalesAnalytics(params.id),
      getProductMovementHistory(params.id),
      getProductSalesHistory(params.id)
    ]);

    // Extract values from settled promises
    const stockBreakdownData = stockBreakdown.status === 'fulfilled' ? stockBreakdown.value : [];
    const salesAnalyticsData = salesAnalytics.status === 'fulfilled' ? salesAnalytics.value : {
      totalUnitsSold: 0,
      totalRevenue: 0,
      avgSellingPrice: 0,
      velocityPerWeek: 0,
      velocityPerMonth: 0,
      velocityPerYear: 0
    };
    const movementHistoryData = movementHistory.status === 'fulfilled' ? movementHistory.value : [];
    const salesHistoryData = salesHistory.status === 'fulfilled' ? salesHistory.value : [];

  return (
    <div className="space-y-6">
      {/* Product Header */}
      <ProductHeader product={product} showBackButton={true} />

      {/* Barcode Section */}
      <ProductBarcode product={product} />

      {/* KPI Cards Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        <StockKPICards product={product} />
        <FinancialKPICards product={product} />
      </div>

      {/* Stock Breakdown */}
      <StockBreakdownTable breakdown={stockBreakdownData} />

      {/* Sales Analytics */}
      <SalesAnalyticsCards analytics={salesAnalyticsData} />

      {/* Sales Chart */}
      {salesHistoryData.length > 0 && (
        <ProductSalesChart salesHistory={salesHistoryData} />
      )}

      {/* Movement History */}
      <MovementHistory movements={movementHistoryData} />
    </div>
    );
  } catch (error) {
    console.error('Error in ProductDetailPage:', error);
    notFound();
  }
}
