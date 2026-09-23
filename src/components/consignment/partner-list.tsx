'use client';

import { channelSummary } from '@/lib/consignment-channels';
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
    channels?: {
      id: string;
      name: string;
      commissionRate: number;
      isDefault: boolean;
      isActive: boolean;
    }[];
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
      key: 'channels',
      label: 'کانال‌های فروش',
      sortable: false,
      render: (partner) => {
        const summary = channelSummary(partner.customer?.channels ?? []);
        return summary ? (
          <span className="text-sm">{summary}</span>
        ) : (
          <span className="text-muted-foreground text-sm">تعریف نشده</span>
        );
      },
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
