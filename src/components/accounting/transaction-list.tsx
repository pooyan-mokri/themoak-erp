'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Transaction, Account, TransactionType, Currency } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { FileSpreadsheet, Printer, X } from 'lucide-react';
import { formatJalaliDate, getStartOfJalaliYear } from '@/lib/date-utils';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { toast } from 'sonner';
import { TransactionReceipt } from '@/components/accounting/transaction-receipt';
import { mayAttachReceipt } from '@/lib/receipt-ref';
import {
  exportJournalToExcel,
  printJournal,
  journalTotals,
  type JournalRow,
} from '@/lib/journal-export';

type TransactionWithAccount = Transaction & { account: Account };

interface JournalRange {
  from?: string;
  to?: string;
  all: boolean;
}

export function TransactionList({
  transactions,
  role,
  range,
  truncated,
  maxRows,
}: {
  transactions: any[];
  role: string | null;
  range: JournalRange;
  truncated: boolean;
  maxRows: number;
}) {
  const router = useRouter();
  const [loading, startNavigation] = useTransition();
  // Period filter — a journal is normally taken for a date range. The server
  // reads the period out of the address, so an older period is fetched rather
  // than filtered out of what happened to be loaded.
  const [fromDate, setFromDate] = useState<Date | undefined>(range.from ? new Date(range.from) : undefined);
  const [toDate, setToDate] = useState<Date | undefined>(range.to ? new Date(range.to) : undefined);

  const iso = (date: Date | undefined) => (date ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : undefined);
  const askFor = (next: { from?: Date; to?: Date; all?: boolean }) => {
    const params = new URLSearchParams();
    if (next.all) params.set('all', '1');
    else {
      const start = iso(next.from);
      const end = iso(next.to);
      if (start) params.set('from', start);
      if (end) params.set('to', end);
    }
    startNavigation(() => router.push(`/dashboard/accounting/transactions${params.size ? `?${params}` : ''}`));
  };

  const chooseFrom = (date: Date | undefined) => {
    setFromDate(date);
    askFor({ from: date, to: toDate });
  };
  const chooseTo = (date: Date | undefined) => {
    setToDate(date);
    askFor({ from: fromDate, to: date });
  };

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (fromDate) {
        const from = new Date(fromDate); from.setHours(0, 0, 0, 0);
        if (new Date(t.date) < from) return false;
      }
      if (toDate) {
        const to = new Date(toDate); to.setHours(23, 59, 59, 999);
        if (new Date(t.date) > to) return false;
      }
      return true;
    });
  }, [transactions, fromDate, toDate]);

  const accountLabel = (t: any) =>
    t.account?.name ?? (t.employee ? `حساب شخصی: ${t.employee.name}` : '-');

  const toRows = (): JournalRow[] =>
    filtered.map((t) => ({
      date: t.date,
      description: t.description,
      type: t.type,
      amount: t.amount,
      currency: t.currency,
      amountInToman: t.amountInToman,
      accountName: accountLabel(t),
      category: t.category,
    }));

  const totals = useMemo(() => journalTotals(toRows()), [filtered]);

  const handleExcel = () => {
    if (filtered.length === 0) { toast.error('سندی برای خروجی وجود ندارد.'); return; }
    exportJournalToExcel(toRows(), fromDate, toDate);
    toast.success('فایل اکسل دانلود شد.');
  };

  const handlePrint = () => {
    if (filtered.length === 0) { toast.error('سندی برای خروجی وجود ندارد.'); return; }
    const ok = printJournal(toRows(), fromDate, toDate);
    if (!ok) toast.error('مرورگر پنجره چاپ را مسدود کرد. لطفا اجازه باز شدن پنجره را بدهید.');
  };

  const columns: DataTableColumn<any>[] = [
    {
      key: 'date',
      label: 'تاریخ',
      sortable: true,
      render: (transaction) => formatJalaliDate(transaction.date),
    },
    {
      key: 'description',
      label: 'شرح',
      sortable: true,
      render: (transaction) => <span className="font-medium">{transaction.description || '-'}</span>,
    },
    {
      key: 'type',
      label: 'نوع',
      sortable: true,
      render: (transaction) => (
        <Badge
          variant={
            transaction.type === 'INCOME'
              ? 'default'
              : transaction.type === 'EXPENSE'
              ? 'destructive'
              : 'secondary'
          }
        >
          {transaction.type === 'INCOME'
            ? 'درآمد'
            : transaction.type === 'EXPENSE'
            ? 'هزینه'
            : transaction.type === 'TRANSFER'
            ? 'انتقال'
            : 'تعدیل'}
        </Badge>
      ),
    },
    {
      key: 'amount',
      label: 'مبلغ',
      sortable: true,
      render: (transaction) => transaction.amount == null ? (
        // A COGS or gift amount, withheld from a role without cost.view.
        <span className="text-muted-foreground">—</span>
      ) : (
        <div className="flex flex-col">
          <span>
            {Number(transaction.amount).toLocaleString('fa-IR')} {transaction.currency}
          </span>
          {transaction.currency !== 'TOMAN' && (
            <span className="text-xs text-muted-foreground">
              ({Number(transaction.amountInToman).toLocaleString('fa-IR')} تومان)
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'account',
      label: 'حساب',
      sortable: true,
      render: (transaction) => {
        if (transaction.account) {
          return transaction.account.name;
        } else if (transaction.employee) {
          return `حساب شخصی: ${transaction.employee.name}`;
        }
        return '-';
      },
    },
    {
      key: 'category',
      label: 'دسته‌بندی',
      sortable: true,
      render: (transaction) => transaction.category || '-',
    },
    {
      key: 'receiptUrl',
      label: 'پیوست',
      sortable: false,
      className: 'text-center',
      render: (transaction) => (
        <TransactionReceipt
          transactionId={transaction.id}
          receiptUrl={transaction.receiptUrl}
          canAttach={mayAttachReceipt(role, transaction)}
          canReplace={role === 'ADMIN'}
        />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
            <JalaliDatePicker
              name="journalFrom"
              label="از تاریخ"
              key={`from-${range.from ?? 'none'}`}
              defaultValue={fromDate}
              onChange={chooseFrom}
              placeholder="ابتدای دوره"
            />
            <JalaliDatePicker
              name="journalTo"
              label="تا تاریخ"
              key={`to-${range.to ?? 'none'}`}
              defaultValue={toDate}
              onChange={chooseTo}
              placeholder="انتهای دوره"
            />
            <div className="space-y-2">
              <Label className="text-sm">خروجی</Label>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleExcel} className="flex-1">
                  <FileSpreadsheet className="h-4 w-4 ml-1" />
                  اکسل
                </Button>
                <Button variant="outline" onClick={handlePrint} className="flex-1">
                  <Printer className="h-4 w-4 ml-1" />
                  PDF / چاپ
                </Button>
              </div>
            </div>
            {(fromDate || toDate) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setFromDate(undefined);
                  setToDate(undefined);
                  askFor({});
                }}
              >
                <X className="h-4 w-4 ml-1" />
                حذف بازه
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">دورهٔ آماده:</span>
            <Button variant="outline" size="sm" onClick={() => { setFromDate(undefined); setToDate(undefined); askFor({}); }}>
              ۳ ماه اخیر
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const start = getStartOfJalaliYear();
                setFromDate(start);
                setToDate(undefined);
                askFor({ from: start });
              }}
            >
              از ابتدای امسال
            </Button>
            <Button
              variant={range.all ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setFromDate(undefined); setToDate(undefined); askFor({ all: true }); }}
            >
              همهٔ تاریخچه
            </Button>
            {loading && <span className="text-muted-foreground">در حال خواندن…</span>}
          </div>

          {truncated && (
            <p className="text-xs text-amber-600">
              فقط {maxRows.toLocaleString('fa-IR')} سند آخر این بازه خوانده شد؛ برای دیدن قدیمی‌ترها بازه را کوچک‌تر کنید.
            </p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">تعداد اسناد</div>
              <div className="font-bold">{filtered.length.toLocaleString('fa-IR')}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">جمع درآمد</div>
              <div className="font-bold text-green-600">{Math.round(totals.income).toLocaleString('fa-IR')}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">جمع هزینه</div>
              <div className="font-bold text-red-600">{Math.round(totals.expense).toLocaleString('fa-IR')}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">خالص</div>
              <div className={`font-bold ${totals.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {Math.round(totals.net).toLocaleString('fa-IR')}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

    <DataTable
      data={filtered}
      columns={columns}
      searchable={true}
      searchPlaceholder="جستجو در تراکنش‌ها (شرح، حساب، دسته‌بندی)..."
      searchKeys={['description', 'account', 'category']}
      filterable={true}
      filters={[
        {
          key: 'type',
          label: 'نوع',
          options: [
            { value: 'INCOME', label: 'درآمد' },
            { value: 'EXPENSE', label: 'هزینه' },
            { value: 'TRANSFER', label: 'انتقال' },
            { value: 'ADJUSTMENT', label: 'تعدیل' },
          ],
        },
      ]}
      defaultSort={{ key: 'date', direction: 'desc' }}
      pageSize={15}
      emptyMessage="هیچ تراکنشی یافت نشد."
    />
    </div>
  );
}
