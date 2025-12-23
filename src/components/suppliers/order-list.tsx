'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { formatJalaliDate } from '@/lib/date-utils';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';

interface PurchaseOrder {
  id: string;
  number: number;
  supplier: { name: string };
  totalAmount: any;
  status: string;
  createdAt: Date;
  items: any[];
}

interface OrderListProps {
  orders: PurchaseOrder[];
  warehouses: { id: string; name: string }[];
}

export function OrderList({ orders, warehouses }: OrderListProps) {
  const columns: DataTableColumn<PurchaseOrder>[] = [
    {
      key: 'number',
      label: 'شماره',
      sortable: true,
      render: (order) => `PO-${order.number}`,
    },
    {
      key: 'supplier',
      label: 'تامین‌کننده',
      sortable: true,
      render: (order) => <span className="font-medium">{order.supplier.name}</span>,
    },
    {
      key: 'totalAmount',
      label: 'مبلغ کل',
      sortable: true,
      render: (order) => `${Number(order.totalAmount).toLocaleString('fa-IR')} تومان`,
    },
    {
      key: 'status',
      label: 'وضعیت',
      sortable: true,
      className: 'text-center',
      render: (order) => (
        <Badge variant={order.status === 'RECEIVED' ? 'default' : 'secondary'}>
          {order.status === 'RECEIVED' ? 'دریافت شده' : order.status}
        </Badge>
      ),
    },
    {
      key: 'createdAt',
      label: 'تاریخ',
      sortable: true,
      render: (order) => formatJalaliDate(order.createdAt),
    },
    {
      key: 'actions',
      label: 'عملیات',
      sortable: false,
      className: 'text-left',
      render: (order) => (
        <Link href={`/dashboard/suppliers/orders/${order.id}`}>
          <Button size="sm" variant="outline">
            مشاهده جزئیات
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">سفارشات خرید</h2>
        <Link href="/dashboard/suppliers/orders/new">
          <Button>
            <Plus className="w-4 h-4 ml-2" />
            سفارش جدید
          </Button>
        </Link>
      </div>

      <DataTable
        data={orders}
        columns={columns}
        searchable={true}
        searchPlaceholder="جستجو در سفارشات (شماره، تامین‌کننده)..."
        searchKeys={['number', 'supplier']}
        filterable={true}
        filters={[
          {
            key: 'status',
            label: 'وضعیت',
            options: [
              { value: 'DRAFT', label: 'پیش‌نویس' },
              { value: 'PENDING_PAYMENT', label: 'در انتظار پرداخت' },
              { value: 'PAID', label: 'پرداخت شده' },
              { value: 'IN_PRODUCTION', label: 'در حال تولید' },
              { value: 'ARRIVED', label: 'رسیده' },
              { value: 'RECEIVED', label: 'دریافت شده' },
            ],
          },
        ]}
        defaultSort={{ key: 'createdAt', direction: 'desc' }}
        pageSize={10}
        emptyMessage="هیچ سفارشی یافت نشد."
      />
    </div>
  );
}
