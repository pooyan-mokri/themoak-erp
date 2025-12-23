import { getLatestExchangeRates } from '@/actions/accounting';
import { ExchangeRateManager } from '@/components/accounting/exchange-rate-list';

export default async function ExchangeRatesPage() {
  const rates = await getLatestExchangeRates();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">مدیریت نرخ ارز</h1>
      <ExchangeRateManager rates={rates} />
    </div>
  );
}
