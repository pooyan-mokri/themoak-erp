import { getConsignmentPartners, settleSales, getPendingSettlements } from '@/actions/consignment';
import { getProducts } from '@/actions/product';
import { getAccounts } from '@/actions/accounting';
import { SettlementForm } from '@/components/consignment/settlement-form';
import { SettlementList } from '@/components/consignment/settlement-list';

export default async function SettlementPage() {
  const partners = await getConsignmentPartners();
  const products = await getProducts();
  const pendingSettlements = await getPendingSettlements();
  const accounts = await getAccounts();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">تسویه حساب امانی</h1>
      <div className="grid gap-6 md:grid-cols-2">
        <SettlementForm partners={partners} products={products} />
        <SettlementList settlements={pendingSettlements} accounts={accounts} />
      </div>
    </div>
  );
}
