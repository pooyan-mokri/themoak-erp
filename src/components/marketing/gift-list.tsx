'use client';

import { formatJalaliDate } from '@/lib/date-utils';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';

interface Gift {
  id: string;
  product?: {
    name: string;
    sku: string;
  };
  quantity: number;
  recipientName?: string;
  account: {
    name: string;
  };
  campaign?: {
    name: string;
  };
  costPrice?: number;
  totalCost?: number;
  reason?: string;
  notes?: string;
  date: Date | string;
}

interface GiftListProps {
  gifts: Gift[];
  canSeeCost: boolean;
}

export function GiftList({ gifts, canSeeCost }: GiftListProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fa-IR').format(Math.round(amount));
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('fa-IR').format(num);
  };

  const allColumns: DataTableColumn<Gift>[] = [
    {
      key: 'date',
      label: 'تاریخ',
      sortable: true,
      render: (gift) => <span className="font-mono text-[12px] text-muted-foreground">{formatJalaliDate(gift.date)}</span>,
    },
    {
      key: 'product',
      label: 'محصول',
      sortable: true,
      render: (gift) => gift.product ? (
        <div>
          <div className="font-medium">{gift.product.name}</div>
          <div className="font-mono text-[11.5px] text-muted-foreground">{gift.product.sku}</div>
        </div>
      ) : (
        <span className="text-muted-foreground">-</span>
      ),
    },
    {
      key: 'quantity',
      label: 'تعداد',
      sortable: true,
      render: (gift) => formatNumber(gift.quantity),
    },
    {
      key: 'recipientName',
      label: 'گیرنده',
      sortable: true,
      render: (gift) => gift.recipientName || <span className="text-muted-foreground">-</span>,
    },
    {
      key: 'campaign',
      label: 'کمپین',
      sortable: true,
      render: (gift) =>
        gift.campaign ? (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11.5px]">{gift.campaign.name}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: 'totalCost',
      label: 'هزینه کل (تومان)',
      sortable: true,
      render: (gift) => (
        <span className="font-medium tabular-nums">{formatCurrency(gift.totalCost ?? 0)}</span>
      ),
    },
    {
      key: 'reason',
      label: 'دلیل',
      sortable: true,
      render: (gift) => <span className="text-sm text-muted-foreground">{gift.reason || '-'}</span>,
    },
  ];
  const columns = canSeeCost ? allColumns : allColumns.filter((column) => column.key !== 'totalCost');

  return (
    <div className="rounded-lg border bg-card p-4">
        <DataTable
          data={gifts}
          columns={columns}
          searchable={true}
          searchPlaceholder="جستجو در هدایا (محصول، گیرنده، مشتری)..."
          searchKeys={['product', 'recipientName']}
          defaultSort={{ key: 'date', direction: 'desc' }}
          pageSize={15}
          emptyMessage="هیچ هدیه بازاریابی ثبت نشده است. هدیه با «ثبت هدیه جدید» از انبار کم و به‌عنوان هزینه بازاریابی ثبت می‌شود."
        />
    </div>
  );
}

