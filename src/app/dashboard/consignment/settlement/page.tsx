import { getConsignmentPartners, getPendingSettlements } from '@/actions/consignment';
import { getProducts } from '@/actions/product';
import { getAccountOptions } from '@/actions/account-options';
import { SettlementForm } from '@/components/consignment/settlement-form';
import { SettlementList } from '@/components/consignment/settlement-list';
import { requireRouteAccess } from '@/lib/access';

export const dynamic = 'force-dynamic';

export default async function SettlementPage() {
  await requireRouteAccess('/dashboard/consignment');
  const partners = await getConsignmentPartners();
  const products = await getProducts();
  const pendingSettlements = await getPendingSettlements();
  const accounts = await getAccountOptions();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">تسویه حساب امانی</h1>
      <p className="text-sm text-muted-foreground">
        گزارش فروش هفتگی/ماهانه همکار را به صورت یک فاکتور ثبت کنید. کمیسیون
        همکار قبلاً از فروش کسر شده و آنچه شما اینجا ثبت می‌کنید مبلغی است که
        همکار باید به شما پرداخت کند.
      </p>
      <div className="space-y-6">
        <SettlementForm partners={partners} products={products} />
        <SettlementList settlements={pendingSettlements} accounts={accounts} />
      </div>
    </div>
  );
}
