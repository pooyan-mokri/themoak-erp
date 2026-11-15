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
import { MovementHistory, type WarehouseMovement } from '@/components/inventory/movement-history';
import { ProductBarcode } from '@/components/inventory/product-barcode';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { formatJalaliDate } from '@/lib/date-utils';
import { hasPermission, requirePermission, requireRouteAccess } from '@/lib/access';

// Older purchase receipts wrote the landed cost into the movement note (as in getWarehouseDetail).
const LANDED_COST_NOTE = / - قیمت تمام‌شده هر واحد: .*$/;

/**
 * The product's stock ledger (InventoryMovement), newest first. Read-only; quantities are stock.view, and the
 * landed cost some receipt notes carry is cut for a role without cost.view.
 */
async function getWarehouseMovements(productId: string, canSeeCost: boolean): Promise<WarehouseMovement[]> {
  await requirePermission('stock.view');
  const rows = await prisma.inventoryMovement.findMany({
    where: { productId },
    include: {
      fromWarehouse: { select: { name: true } },
      toWarehouse: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return rows.map((m: any) => ({
    id: m.id,
    type: m.type,
    quantity: m.quantity,
    from: m.fromWarehouse?.name ?? null,
    to: m.toWarehouse?.name ?? null,
    note: canSeeCost ? (m.note ?? '') : (m.note ?? '').replace(LANDED_COST_NOTE, ''),
    dateFormatted: formatJalaliDate(m.createdAt, 'jYYYY/jMM/jDD HH:mm'),
  }));
}

export default async function ProductDetailPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  await requireRouteAccess('/dashboard/inventory');
  const params = await paramsPromise;
  const [canSeeCost, canSeeSellPrice, canManage, canEditCost, canSell] = await Promise.all([
    hasPermission('cost.view'),
    hasPermission('sales.view'),
    hasPermission('stock.manage'),
    hasPermission('cost.edit'),
    hasPermission('sales.manage'),
  ]);
  try {
    // Fetch product first to check if it exists
    const productData = await getProductDetail(params.id);

    if (!productData) {
      notFound();
    }

    // TypeScript-safe: product is guaranteed to exist after notFound() check
    const product = productData;

    // Fetch other data in parallel (with error handling for each)
    const [stockBreakdown, salesAnalytics, movementHistory, salesHistory, warehouseMovements] = await Promise.allSettled([
      getProductStockBreakdown(params.id),
      getProductSalesAnalytics(params.id),
      getProductMovementHistory(params.id),
      getProductSalesHistory(params.id),
      getWarehouseMovements(params.id, canSeeCost),
    ]);

    // Extract values from settled promises
    const stockBreakdownData = stockBreakdown.status === 'fulfilled' ? stockBreakdown.value : [];
    const salesAnalyticsData = salesAnalytics.status === 'fulfilled' ? salesAnalytics.value : {
      totalUnitsSold: 0,
      velocityPerWeek: 0,
      velocityPerMonth: 0,
      velocityPerYear: 0
    };
    const movementHistoryData = movementHistory.status === 'fulfilled' ? movementHistory.value : [];
    const salesHistoryData = salesHistory.status === 'fulfilled' ? salesHistory.value : [];
    const warehouseMovementsData = warehouseMovements.status === 'fulfilled' ? warehouseMovements.value : undefined;

  return (
    <div className="space-y-4">
      <ProductHeader
        product={product}
        showBackButton={true}
        canSell={canSell}
        canManage={canManage}
        canEditCost={canEditCost}
        canSeeSellPrice={canSeeSellPrice}
      />

      {/* Figures: stock for everyone, money for the roles that may see it */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <StockKPICards product={product} warehouseCount={stockBreakdownData.length} />
        {(canSeeCost || canSeeSellPrice) && <FinancialKPICards product={product} />}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <StockBreakdownTable breakdown={stockBreakdownData} />
          {/* Sales Chart */}
          {salesHistoryData.length > 0 && (
            <ProductSalesChart salesHistory={salesHistoryData} />
          )}
        </div>
        <div className="space-y-4">
          <ProductBarcode product={product} canManage={canManage} />
          <SalesAnalyticsCards analytics={salesAnalyticsData} />
        </div>
      </div>

      <MovementHistory movements={movementHistoryData} warehouseMovements={warehouseMovementsData} />
    </div>
    );
  } catch (error) {
    console.error('Error in ProductDetailPage:', error);
    notFound();
  }
}
