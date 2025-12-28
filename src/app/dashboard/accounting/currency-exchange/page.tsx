import { getAccounts } from '@/actions/accounting';
import { getCurrencyExchangeHistory } from '@/actions/currency-exchange';
import { CurrencyExchangeForm } from '@/components/accounting/currency-exchange-form';
import { CurrencyExchangeHistory } from '@/components/accounting/currency-exchange-history';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default async function CurrencyExchangePage() {
  const accounts = await getAccounts();
  const history = await getCurrencyExchangeHistory();

  // Convert Decimal to number for client
  const accountsWithNumbers = accounts.map((account: any) => ({
    ...account,
    balance: Number(account.balance),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">خرید و فروش ارز</h1>
        <p className="text-muted-foreground mt-2">
          انجام معاملات خرید و فروش ارز بین حساب‌های مختلف
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <CurrencyExchangeForm accounts={accountsWithNumbers} />
        
        <Card>
          <CardHeader>
            <CardTitle>راهنما</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <h3 className="font-semibold mb-2">خرید ارز:</h3>
              <p className="text-muted-foreground">
                از حساب تومان برداشت کنید و به حساب ارز (USD, EUR, CNY) واریز کنید.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">فروش ارز:</h3>
              <p className="text-muted-foreground">
                از حساب ارز برداشت کنید و به حساب تومان واریز کنید.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">نکات مهم:</h3>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>نوع ارز حساب مبدا و مقصد باید متفاوت باشند</li>
                <li>موجودی حساب مبدا باید کافی باشد</li>
                <li>نرخ تبدیل به صورت خودکار محاسبه می‌شود</li>
                <li>هر معامله دو تراکنش ایجاد می‌کند (برداشت و واریز)</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      <CurrencyExchangeHistory history={history} />
    </div>
  );
}



