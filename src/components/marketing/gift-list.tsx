'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatJalaliDate } from '@/lib/date-utils';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';

interface Gift {
  id: string;
  product: {
    name: string;
    sku: string;
  };
  quantity: number;
  recipientName?: string;
  account: {
    name: string;
  };
  campaign: {
    name: string;
  } | null;
  costPrice: number;
  totalCost: number;
  reason?: string;
  notes?: string;
  date: Date | string;
}

interface GiftListProps {
  gifts: Gift[];
}

export function GiftList({ gifts }: GiftListProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fa-IR').format(Math.round(amount)) + ' تومان';
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('fa-IR').format(num);
  };

  const columns: DataTableColumn<Gift>[] = [
    {
      key: 'date',
      label: 'تاریخ',
      sortable: true,
      render: (gift) => formatJalaliDate(gift.date),
    },
    {
      key: 'product',
      label: 'محصول',
      sortable: true,
      render: (gift) => (
        <div>
          <div className="font-medium">{gift.product.name}</div>
          <div className="text-xs text-muted-foreground">SKU: {gift.product.sku}</div>
        </div>
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
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            {gift.campaign.name}
          </Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      key: 'totalCost',
      label: 'هزینه کل',
      sortable: true,
      render: (gift) => (
        <span className="font-bold text-red-600">{formatCurrency(gift.totalCost)}</span>
      ),
    },
    {
      key: 'reason',
      label: 'دلیل',
      sortable: true,
      render: (gift) => <span className="text-sm text-muted-foreground">{gift.reason || '-'}</span>,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>تاریخچه هدایای بازاریابی</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          data={gifts}
          columns={columns}
          searchable={true}
          searchPlaceholder="جستجو در هدایا (محصول، گیرنده، مشتری)..."
          searchKeys={['product', 'recipientName']}
          defaultSort={{ key: 'date', direction: 'desc' }}
          pageSize={15}
          emptyMessage="هیچ هدیه بازاریابی ثبت نشده است."
        />
      </CardContent>
    </Card>
  );
}

