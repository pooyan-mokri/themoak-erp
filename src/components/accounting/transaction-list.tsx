'use client';

import { Transaction, Account, TransactionType, Currency } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { FileText, Image as ImageIcon } from 'lucide-react';
import { formatJalaliDate } from '@/lib/date-utils';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';

type TransactionWithAccount = Transaction & { account: Account };

export function TransactionList({ transactions }: { transactions: any[] }) {
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
      render: (transaction) => (
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
      render: (transaction) =>
        transaction.receiptUrl ? (
          <a
            href={transaction.receiptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center h-8 w-8 rounded-full hover:bg-muted"
            title="مشاهده رسید"
          >
            {transaction.receiptType?.startsWith('image/') ? (
              <ImageIcon className="h-4 w-4 text-blue-500" />
            ) : (
              <FileText className="h-4 w-4 text-red-500" />
            )}
          </a>
        ) : (
          <span className="text-muted-foreground text-xs">-</span>
        ),
    },
  ];

  return (
    <DataTable
      data={transactions}
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
  );
}
