'use client';

import { Badge } from '@/components/ui/badge';
import { PartnerEditForm } from './partner-edit-form';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';

interface Partner {
  id: string;
  name: string;
  customer?: {
    id: string;
    name: string;
    phone?: string;
    address?: string;
    commissionRate?: number;
  };
}

interface PartnerListProps {
  partners: Partner[];
}

export function PartnerList({ partners }: PartnerListProps) {
  const columns: DataTableColumn<Partner>[] = [
    {
      key: 'name',
      label: 'نام همکار',
      sortable: true,
      render: (partner) => (
        <span className="font-medium">
          {partner.customer?.name || partner.name.replace('انبار امانی - ', '')}
        </span>
      ),
    },
    {
      key: 'phone',
      label: 'شماره تماس',
      sortable: true,
      render: (partner) => partner.customer?.phone || '-',
    },
    {
      key: 'commissionRate',
      label: 'کمیسیون',
      sortable: true,
      render: (partner) =>
        partner.customer?.commissionRate !== null && partner.customer?.commissionRate !== undefined ? (
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            {partner.customer.commissionRate}%
          </Badge>
        ) : (
          <span className="text-muted-foreground text-sm">تعریف نشده</span>
        ),
    },
    {
      key: 'actions',
      label: 'عملیات',
      sortable: false,
      className: 'text-right',
      render: (partner) => <PartnerEditForm partner={partner} />,
    },
  ];

  return (
    <DataTable
      data={partners}
      columns={columns}
      searchable={true}
      searchPlaceholder="جستجو در همکاران (نام، شماره تماس)..."
      searchKeys={['name', 'customer']}
      defaultSort={{ key: 'name', direction: 'asc' }}
      pageSize={10}
      emptyMessage="هیچ همکاری یافت نشد."
    />
  );
}
