import { getLatestExchangeRates } from '@/actions/accounting';
import { ExchangeRateManager } from '@/components/accounting/exchange-rate-list';
import { requireRouteAccess } from '@/lib/access';

export default async function ExchangeRatesPage() {
  await requireRouteAccess('/dashboard/accounting');
  const rates = await getLatestExchangeRates();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">مدیریت نرخ ارز</h1>
      <ExchangeRateManager rates={rates} />
    </div>
  );
}
