'use client';

import { OrderItem, Product } from '@prisma/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eye } from 'lucide-react';
import Link from 'next/link';
import { formatJalaliDateTime } from '@/lib/date-utils';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';

type Customer = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  wooId?: number;
  taxId?: string;
  segment?: string;
  creditLimit?: number;
  commissionRate?: number;
  createdAt: Date;
  updatedAt: Date;
  type: string;
  paymentTerms: number;
};

type OrderWithDetails = {
  id: string;
  number: number;
  createdAt: Date;
  updatedAt: Date;
  wooId?: number;
  customerId?: string;
  status: string;
  totalAmount: number;
  transactionId?: string;
  discount?: number;
  paidAmount?: number;
  paymentStatus: string;
  invoiceId?: string;
  customer?: Customer;
  items: (OrderItem & { product: Product })[];
};

interface OrderListProps {
  orders: OrderWithDetails[];
}

export function OrderList({ orders }: OrderListProps) {
  const columns: DataTableColumn<OrderWithDetails>[] = [
    {
      key: 'number',
      label: 'شماره سفارش',
      sortable: true,
      render: (order) => `#${order.number}`,
    },
    {
      key: 'customer',
      label: 'مشتری',
      sortable: true,
      render: (order) => order.customer?.name || 'مشتری عمومی',
    },
    {
      key: 'totalAmount',
      label: 'مبلغ کل',
      sortable: true,
      render: (order) => `${Number(order.totalAmount).toLocaleString('fa-IR')} تومان`,
    },
    {
      key: 'items',
      label: 'تعداد اقلام',
      sortable: false,
      render: (order) => `${order.items.reduce((acc, item) => acc + item.quantity, 0)} عدد`,
    },
    {
      key: 'status',
      label: 'وضعیت',
      sortable: true,
      render: (order) => (
        <Badge variant={order.status === 'COMPLETED' ? 'default' : 'secondary'}>
          {order.status === 'COMPLETED' ? 'تکمیل شده' : order.status}
        </Badge>
      ),
    },
    {
      key: 'createdAt',
      label: 'تاریخ',
      sortable: true,
      render: (order) => formatJalaliDateTime(order.createdAt),
    },
    {
      key: 'actions',
      label: 'عملیات',
      sortable: false,
      className: 'text-left',
      render: (order) => (
        <Link href={`/dashboard/sales/history/${order.id}`}>
          <Button variant="outline" size="sm">
            <Eye className="mr-2 h-4 w-4" />
            مشاهده جزئیات
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <DataTable
      data={orders}
      columns={columns}
      searchable={true}
      searchPlaceholder="جستجو در سفارشات (شماره، مشتری)..."
      searchKeys={['number', 'customer']}
      filterable={true}
      filters={[
        {
          key: 'status',
          label: 'وضعیت',
          options: [
            { value: 'COMPLETED', label: 'تکمیل شده' },
            { value: 'PENDING', label: 'در انتظار' },
            { value: 'CANCELLED', label: 'لغو شده' },
          ],
        },
      ]}
      defaultSort={{ key: 'createdAt', direction: 'desc' }}
      pageSize={10}
      emptyMessage="هیچ سفارشی یافت نشد."
    />
  );
}
