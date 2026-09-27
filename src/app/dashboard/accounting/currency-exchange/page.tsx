import { getAccounts, getLatestExchangeRates } from '@/actions/accounting';
import { getCurrencyExchangeHistory } from '@/actions/currency-exchange';
import { CurrencyExchangeForm } from '@/components/accounting/currency-exchange-form';
import { CurrencyExchangeHistory } from '@/components/accounting/currency-exchange-history';
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { SectionCard } from '@/components/dashboard/section-card';
import { formatJalaliDate } from '@/lib/date-utils';
import { getCurrentRole, hasPermission, requireRouteAccess } from '@/lib/access';

const fa = (n: number, digits = 0) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits }).format(n);

/**
 * خرید و فروش ارز: موجودی حساب‌های ارزی، ثبت معامله (finance.manage) با نمای
 * قبل و بعد موجودی، و فهرست معاملات با ویرایش و حذف برای مدیر.
 */
export default async function CurrencyExchangePage() {
  await requireRouteAccess('/dashboard/accounting');
  const accounts = await getAccounts();
  const history = await getCurrencyExchangeHistory();
  const rates = await getLatestExchangeRates();
  // Correcting a recorded exchange stays with the admin, like a recorded expense.
  const isAdmin = (await getCurrentRole()) === 'ADMIN';
  const canManage = await hasPermission('finance.manage');

  // Convert Decimal to number for client
  const accountsWithNumbers = accounts.map((account: any) => ({
    ...account,
    balance: Number(account.balance),
  }));

  // Each foreign-currency account, valued at the latest recorded rate of its currency.
  const latestRate = (currency: string) => rates.find((rate: any) => rate.currency === currency);
  const holdings = accountsWithNumbers.filter((account: any) => account.currency !== 'TOMAN');

  return (
    <div className="space-y-4">
      <PageHeader
        title="خرید و فروش ارز"
        description="خرید ارز با تومان، فروش ارز به تومان، یا تبدیل ارزی به ارز دیگر بین حساب‌ها"
      />

      {holdings.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {holdings.map((account: any) => {
            const rate = latestRate(account.currency);
            return (
              <KpiCard
                key={account.id}
                label={account.name}
                value={fa(account.balance, 2)}
                unit={account.currency}
                note={
                  rate
                    ? `≈ ${fa(account.balance * rate.rateToToman)} تومان · نرخ ${formatJalaliDate(rate.date)}`
                    : 'نرخی برای این ارز ثبت نشده است'
                }
              />
            );
          })}
        </div>
      ) : (
        <p className="rounded-lg border bg-card px-4 py-3 text-[13px] text-muted-foreground">
          هنوز حساب ارزی ندارید. برای خرید ارز، اول یک حساب دلاری، یورویی یا یوآنی در صفحه حساب‌ها بسازید.
        </p>
      )}

      <div className={canManage ? 'grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_420px]' : undefined}>
        <CurrencyExchangeHistory history={history} isAdmin={isAdmin} accounts={accountsWithNumbers} />

        {canManage && (
          <div className="space-y-4">
            <CurrencyExchangeForm accounts={accountsWithNumbers} />
            <SectionCard title="نکته‌ها">
              <ul className="list-inside list-disc space-y-1 text-[12.5px] text-muted-foreground">
                <li>نوع ارز حساب مبدأ و مقصد باید متفاوت باشد.</li>
                <li>موجودی حساب مبدأ باید کافی باشد.</li>
                <li>با یک طرف تومانی، نرخ از دو مبلغ حساب می‌شود و باید با آن‌ها بخواند.</li>
                <li>هر معامله دو سند می‌سازد: برداشت از مبدأ و واریز به مقصد.</li>
              </ul>
            </SectionCard>
          </div>
        )}
      </div>
    </div>
  );
}
