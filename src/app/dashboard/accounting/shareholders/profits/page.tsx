import { getShareholderProfits } from '@/actions/shareholder-profit';
import { getAccounts } from '@/actions/accounting';
import { ShareholderProfitForm } from '@/components/accounting/shareholder-profit-form';
import { ShareholderProfitList } from '@/components/accounting/shareholder-profit-list';

export default async function ShareholderProfitsPage() {
  const profits = await getShareholderProfits();
  const accounts = await getAccounts();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">مدیریت سود قابل برداشت</h1>
      
      <div className="grid gap-6 md:grid-cols-2">
        <ShareholderProfitForm />
        <ShareholderProfitList profits={profits} accounts={accounts} />
      </div>
    </div>
  );
}

