import Link from 'next/link';
import { Coins } from 'lucide-react';
import { getShareholderCapitalEvents, getShareholders, getShareholdersWithBalance } from '@/actions/shareholder';
import { getAccounts } from '@/actions/accounting';
import { NewShareholderButton, ShareholderList } from '@/components/accounting/shareholder-list';
import { ShareholderDepositForm } from '@/components/accounting/shareholder-deposit-form';
import { ShareholderWithdrawalForm } from '@/components/accounting/shareholder-withdrawal-form';
import { ShareholderBalanceList } from '@/components/accounting/shareholder-balance-list';
import { LegendItem, SERIES, StackBar, fa } from '@/components/accounting/finance-bits';
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { SectionCard } from '@/components/dashboard/section-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { formatJalaliDate } from '@/lib/date-utils';
import { hasPermission, requireRouteAccess } from '@/lib/access';

const UNALLOCATED = '#E3E3E3';

/**
 * سهامداران: ترکیب مالکیت، مانده سرمایه هر سهامدار و رویدادهای سرمایه؛ تعریف
 * سهامدار و واریز و برداشت سرمایه برای finance.manage؛ پیوند سود قابل برداشت برای profit.view.
 */
export default async function ShareholdersPage() {
  await requireRouteAccess('/dashboard/accounting');
  const shareholders = await getShareholders();
  const shareholdersWithBalance = await getShareholdersWithBalance();
  const accounts = await getAccounts();
  const events = await getShareholderCapitalEvents();
  const [canManage, canSeeProfit] = await Promise.all([hasPermission('finance.manage'), hasPermission('profit.view')]);

  const allocated = shareholders.reduce((sum: number, s: any) => sum + s.percentage, 0);
  const balances = Object.fromEntries(shareholdersWithBalance.map((s: any) => [s.id, s.balance]));
  const owedToHolders = shareholdersWithBalance.filter((s: any) => s.balance > 0);
  const owedByHolders = shareholdersWithBalance.filter((s: any) => s.balance < 0);
  // The largest holding first, for the ownership bar.
  const byShare = [...shareholders].sort((a: any, b: any) => b.percentage - a.percentage);

  return (
    <div className="space-y-4">
      <PageHeader
        title="سهامداران"
        description={`${fa(shareholders.length)} سهامدار · ${fa(allocated, 2)}٪ سهم ثبت‌شده`}
        actions={
          <>
            {canSeeProfit && (
              <Button variant="outline" asChild>
                <Link href="/dashboard/accounting/shareholders/profits">
                  <Coins className="h-4 w-4" />
                  سود قابل برداشت
                </Link>
              </Button>
            )}
            {canManage && <NewShareholderButton />}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="سهامداران"
          value={fa(shareholders.length)}
          note={`${fa(shareholders.reduce((sum: number, s: any) => sum + s._count.transactions, 0))} تراکنش ثبت‌شده`}
        />
        <KpiCard
          label="سهم ثبت‌شده"
          value={`${fa(allocated, 2)}٪`}
          note={allocated < 100 ? `${fa(100 - allocated, 2)}٪ تخصیص‌نیافته` : allocated === 100 ? 'همه سهم‌ها تخصیص یافته' : 'بیش از ۱۰۰٪'}
        />
        <KpiCard
          label="بدهی شرکت به سهامداران"
          value={owedToHolders.length ? fa(owedToHolders.reduce((sum: number, s: any) => sum + s.balance, 0)) : '—'}
          unit={owedToHolders.length ? 'تومان' : undefined}
          note={owedToHolders.length ? `${fa(owedToHolders.length)} سهامدار طلبکار` : 'واریز سرمایه‌ای باز نیست'}
        />
        <KpiCard
          label="طلب از سهامداران"
          value={owedByHolders.length ? fa(-owedByHolders.reduce((sum: number, s: any) => sum + s.balance, 0)) : '—'}
          unit={owedByHolders.length ? 'تومان' : undefined}
          note={owedByHolders.length ? `${fa(owedByHolders.length)} سهامدار بدهکار` : 'برداشت بازی نیست'}
        />
      </div>

      {shareholders.length > 0 && (
        <SectionCard title="ترکیب مالکیت">
          <StackBar
            className="h-[22px]"
            total={Math.max(100, allocated)}
            parts={[
              ...byShare.map((s: any, i: number) => ({
                key: s.id,
                value: s.percentage,
                color: SERIES[i % SERIES.length],
                title: `${s.name}: ${fa(s.percentage, 2)}٪`,
              })),
              { key: 'rest', value: 100 - allocated, color: UNALLOCATED, title: 'تخصیص‌نیافته' },
            ]}
          />
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-muted-foreground">
            {byShare.map((s: any, i: number) => (
              <LegendItem key={s.id} color={SERIES[i % SERIES.length]}>
                <span className="text-foreground">{s.name}</span> · <span className="tabular-nums">{fa(s.percentage, 2)}٪</span>
              </LegendItem>
            ))}
            {allocated < 100 && (
              <LegendItem color={UNALLOCATED}>
                تخصیص‌نیافته · <span className="tabular-nums">{fa(100 - allocated, 2)}٪</span>
              </LegendItem>
            )}
          </div>
        </SectionCard>
      )}

      <Tabs defaultValue="manage" className="space-y-4">
        <TabsList>
          <TabsTrigger value="manage">سهامداران</TabsTrigger>
          {canManage && <TabsTrigger value="deposit">واریز سرمایه</TabsTrigger>}
          {canManage && <TabsTrigger value="withdraw">برداشت سرمایه</TabsTrigger>}
          <TabsTrigger value="balance">موجودی و بدهی</TabsTrigger>
        </TabsList>

        <TabsContent value="manage">
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <ShareholderList shareholders={shareholders} balances={balances} canManage={canManage} />
            <SectionCard title="رویدادهای سرمایه" count={fa(events.length)} aside={<span className="text-muted-foreground">مبلغ به تومان</span>}>
              {events.length === 0 ? (
                <p className="py-4 text-[13px] text-muted-foreground">
                  هنوز واریز یا برداشت سرمایه‌ای ثبت نشده است.{canManage && ' از زبانه «واریز سرمایه» ثبت کنید.'}
                </p>
              ) : (
                <ul className="-my-1 max-h-[440px] divide-y overflow-y-auto">
                  {events.map((event) => (
                    <li key={event.id} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 py-2.5">
                      <span className="text-[13px]">
                        {event.kind === 'deposit' ? 'واریز سرمایه' : 'برداشت سرمایه'} · {event.shareholderName}
                      </span>
                      <span className="text-end text-[13px] font-medium tabular-nums">{fa(event.amountInToman)}</span>
                      <span className="text-[11.5px] text-muted-foreground">
                        {formatJalaliDate(event.date)}
                        {event.accountName && ` · ${event.accountName}`}
                      </span>
                      <span className="text-end text-[11.5px] text-muted-foreground">
                        {event.currency === 'TOMAN' ? 'تومان' : `${fa(event.amount, 2)} ${event.currency}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {events.length >= 100 && (
                <p className="mt-2 border-t pt-2 text-[12px] text-muted-foreground">
                  ۱۰۰ رویداد آخر؛ همه در{' '}
                  <Link href="/dashboard/accounting/transactions" className="text-brand hover:underline">
                    دفتر روزنامه
                  </Link>
                  .
                </p>
              )}
            </SectionCard>
          </div>
        </TabsContent>

        {canManage && (
          <TabsContent value="deposit">
            <div className="max-w-2xl">
              <ShareholderDepositForm shareholders={shareholders} accounts={accounts} />
            </div>
          </TabsContent>
        )}

        {canManage && (
          <TabsContent value="withdraw">
            <div className="max-w-2xl">
              <ShareholderWithdrawalForm shareholders={shareholders} accounts={accounts} />
            </div>
          </TabsContent>
        )}

        <TabsContent value="balance">
          <ShareholderBalanceList shareholders={shareholdersWithBalance} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
