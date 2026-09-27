import { getShareholderProfits } from '@/actions/shareholder-profit';
import { getAccounts } from '@/actions/accounting';
import { ShareholderProfitForm } from '@/components/accounting/shareholder-profit-form';
import { ShareholderProfitList } from '@/components/accounting/shareholder-profit-list';
import { PageHeader } from '@/components/layout/page-header';
import { requireRouteAccess } from '@/lib/access';

export default async function ShareholderProfitsPage() {
  await requireRouteAccess('/dashboard/accounting/shareholders/profits');
  const profits = await getShareholderProfits();
  const accounts = await getAccounts();

  return (
    <div className="space-y-4">
      <PageHeader title="سود قابل برداشت" description="محاسبه سود هر دوره به نسبت سهم، و پرداخت آن به سهامداران" />

      <div className="grid gap-4 md:grid-cols-2">
        <ShareholderProfitForm />
        <ShareholderProfitList profits={profits} accounts={accounts} />
      </div>
    </div>
  );
}

