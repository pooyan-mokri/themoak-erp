'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Currency } from '@/lib/types';
import { formatJalaliDate } from '@/lib/date-utils';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { deleteCurrencyExchange } from '@/actions/currency-exchange';
import { CurrencyExchangeEditDialog } from './currency-exchange-edit-dialog';

interface CurrencyExchangeHistoryProps {
  history: Array<{
    id: string;
    date: Date;
    sourceAccountId: string | null;
    targetAccountId: string | null;
    sourceAccount: string | null;
    targetAccount: string | null;
    sourceAmount: number | null;
    targetAmount: number | null;
    sourceCurrency: Currency | null;
    targetCurrency: Currency | null;
    exchangeRate: number;
    description?: string;
    complete: boolean;
  }>;
  /** May correct or remove a recorded exchange (admin only). */
  isAdmin?: boolean;
  accounts?: Array<{ id: string; name: string; currency: Currency }>;
}

/** What kind of trade a row is, from the currencies of its two legs. */
function kindOf(source: Currency | null, target: Currency | null) {
  if (source === Currency.TOMAN) return 'خرید';
  if (target === Currency.TOMAN) return 'فروش';
  if (source && target) return 'ارز به ارز';
  return '—';
}

export function CurrencyExchangeHistory({ history, isAdmin = false, accounts = [] }: CurrencyExchangeHistoryProps) {
  const router = useRouter();

  const formatCurrency = (amount: number | null, currency: Currency | null) => {
    if (amount === null || currency === null) return '—';
    return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(amount);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('fa-IR', {
      maximumFractionDigits: 6,
    }).format(num);
  };

  const handleDelete = async (id: string) => {
    const result = await deleteCurrencyExchange(id);
    if (result.success) {
      toast.success(result.message);
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  const leg = (name: string | null, amount: number | null, currency: Currency | null) => (
    <div className="min-w-0">
      <div className="tabular-nums">
        {formatCurrency(amount, currency)}{' '}
        {currency && <span className="font-mono text-[11px] text-muted-foreground">{currency === Currency.TOMAN ? 'تومان' : currency}</span>}
      </div>
      <div className="truncate text-[12px] text-muted-foreground">{name ?? '—'}</div>
    </div>
  );

  const describe = (e: CurrencyExchangeHistoryProps['history'][number]) =>
    `${formatJalaliDate(e.date)}: ${formatCurrency(e.sourceAmount, e.sourceCurrency)} ${e.sourceCurrency ?? ''} از «${e.sourceAccount ?? '—'}» به ${formatCurrency(e.targetAmount, e.targetCurrency)} ${e.targetCurrency ?? ''} در «${e.targetAccount ?? '—'}»`;

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <h3 className="text-sm font-medium">معاملات ثبت‌شده</h3>
        <span className="rounded bg-secondary px-1.5 font-mono text-[11px] text-muted-foreground">
          {new Intl.NumberFormat('fa-IR').format(history.length)}
        </span>
      </div>
      {history.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-y">
                <th className="h-9 bg-secondary px-4 text-start text-xs font-normal text-muted-foreground">تاریخ</th>
                <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">نوع</th>
                <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">برداشت از</th>
                <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">واریز به</th>
                <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">نرخ تبدیل</th>
                <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">توضیحات</th>
                {isAdmin && <th className="h-9 w-[92px] bg-secondary px-3" />}
              </tr>
            </thead>
            <tbody>
              {history.map((exchange) => (
                <tr key={exchange.id} className="border-b transition-colors duration-150 last:border-0 hover:bg-brand/[.04]">
                  <td className="whitespace-nowrap px-4 py-2 tabular-nums text-muted-foreground">
                    {formatJalaliDate(exchange.date)}
                    {!exchange.complete && (
                      <span className="ms-2 rounded-full bg-danger-soft px-2 py-0.5 text-[11.5px] text-danger">سند ناقص</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11.5px] text-muted-foreground">
                      {kindOf(exchange.sourceCurrency, exchange.targetCurrency)}
                    </span>
                  </td>
                  <td className="px-3 py-2">{leg(exchange.sourceAccount, exchange.sourceAmount, exchange.sourceCurrency)}</td>
                  <td className="px-3 py-2">{leg(exchange.targetAccount, exchange.targetAmount, exchange.targetCurrency)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{formatNumber(exchange.exchangeRate)}</td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-[12.5px] text-muted-foreground" title={exchange.description}>
                    {exchange.description || '—'}
                  </td>
                  {isAdmin && (
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <CurrencyExchangeEditDialog exchange={exchange} accounts={accounts} />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-danger hover:bg-danger-soft" title="حذف معامله">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>حذف معامله ارز</AlertDialogTitle>
                              <AlertDialogDescription>
                                این معامله حذف شود؟ {describe(exchange)}. مبلغ‌ها به حساب مبدأ و مقصد برمی‌گردد. این عملیات قابل
                                بازگشت نیست.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>انصراف</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(exchange.id)}
                                className="bg-danger text-white hover:bg-danger/90"
                              >
                                حذف
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="border-t px-4 py-8 text-center text-[13px] text-muted-foreground">
          هنوز معامله ارزی ثبت نشده است. هر خرید یا فروش ارز، با دو سند برداشت و واریز، اینجا می‌آید.
        </p>
      )}
    </div>
  );
}
