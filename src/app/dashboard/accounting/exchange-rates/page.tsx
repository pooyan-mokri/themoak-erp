import { getLatestExchangeRates } from '@/actions/accounting';
import { ExchangeRateManager } from '@/components/accounting/exchange-rate-list';
import { hasPermission, requireRouteAccess } from '@/lib/access';

/** نرخ ارز: آخرین نرخ هر ارز با تغییر هفتگی و روند، مبدل، ثبت نرخ (finance.manage) و تاریخچه. */
export default async function ExchangeRatesPage() {
  await requireRouteAccess('/dashboard/accounting');
  const [rates, canManage] = await Promise.all([getLatestExchangeRates(), hasPermission('finance.manage')]);

  return <ExchangeRateManager rates={rates} canManage={canManage} />;
}
