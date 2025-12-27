'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Edit, Trash2, TrendingDown } from 'lucide-react';
import { formatJalaliDate } from '@/lib/date-utils';
import { formatCurrency } from '@/lib/utils';
import { deleteAsset, postDepreciation } from '@/actions/fixed-assets';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';

interface Asset {
  id: string;
  name: string;
  assetType: string;
  purchaseDate: Date;
  purchasePrice: number;
  salvageValue: number;
  usefulLife: number;
  quantity?: number;
  depreciationMethod: string;
  currentValue: number;
  createdAt: Date;
}

interface AssetListProps {
  assets: Asset[];
}

export function AssetList({ assets }: AssetListProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | undefined>(undefined);

  const handleDelete = async (assetId: string) => {
    if (confirm('آیا از حذف این دارایی اطمینان دارید؟')) {
      setLoading(assetId);
      try {
        const result = await deleteAsset(assetId);
        if (result.success) {
          toast.success(result.message);
        } else {
          toast.error(result.message || 'خطا در حذف دارایی');
        }
        router.refresh();
      } catch (error) {
        toast.error('خطا در حذف دارایی');
      } finally {
        setLoading(null);
      }
    }
  };

  const handleDepreciation = async (assetId: string) => {
    if (confirm('آیا می‌خواهید استهلاک این دارایی را ثبت کنید؟')) {
      setLoading(assetId);
      try {
        const result = await postDepreciation(assetId);
        if (result.success) {
          toast.success(result.message);
        } else {
          toast.error(result.error || 'خطا در ثبت استهلاک');
        }
        router.refresh();
      } catch (error) {
        toast.error('خطا در ثبت استهلاک');
      } finally {
        setLoading(null);
      }
    }
  };

  const calculateDepreciation = (asset: Asset) => {
    const depreciation = Number(asset.purchasePrice) - asset.currentValue;
    const depreciationPercent = (depreciation / Number(asset.purchasePrice)) * 100;
    return { depreciation, depreciationPercent };
  };

  const columns: DataTableColumn<Asset>[] = [
    {
      key: 'name',
      label: 'نام دارایی',
      sortable: true,
      render: (asset) => <span className="font-medium">{asset.name}</span>,
    },
    {
      key: 'assetType',
      label: 'نوع',
      sortable: true,
      render: (asset) => {
        const assetTypeLabel = asset.assetType === 'FIXED' ? 'دارایی ثابت' : 'کالای مصرفی';
        const assetTypeBadge = asset.assetType === 'FIXED' 
          ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
          : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
        return (
          <Badge variant="outline" className={assetTypeBadge}>
            {assetTypeLabel}
          </Badge>
        );
      },
    },
    {
      key: 'quantity',
      label: 'تعداد',
      sortable: true,
      render: (asset) =>
        asset.assetType === 'CONSUMABLE' && asset.quantity !== null && asset.quantity !== undefined
          ? asset.quantity.toLocaleString('fa-IR')
          : '-',
    },
    {
      key: 'purchaseDate',
      label: 'تاریخ خرید',
      sortable: true,
      render: (asset) => formatJalaliDate(asset.purchaseDate),
    },
    {
      key: 'purchasePrice',
      label: 'قیمت خرید',
      sortable: true,
      render: (asset) => formatCurrency(Number(asset.purchasePrice)),
    },
    {
      key: 'currentValue',
      label: 'ارزش فعلی',
      sortable: true,
      render: (asset) => <span className="font-semibold">{formatCurrency(asset.currentValue)}</span>,
    },
    {
      key: 'depreciation',
      label: 'استهلاک',
      sortable: false,
      render: (asset) => {
        const { depreciation, depreciationPercent } = calculateDepreciation(asset);
        return (
          <div className="flex flex-col">
            <span className="text-sm text-muted-foreground">{formatCurrency(depreciation)}</span>
            <Badge variant="outline" className="w-fit">
              {depreciationPercent.toFixed(1)}%
            </Badge>
          </div>
        );
      },
    },
    {
      key: 'usefulLife',
      label: 'عمر مفید',
      sortable: true,
      render: (asset) => `${asset.usefulLife} سال`,
    },
    {
      key: 'actions',
      label: 'عملیات',
      sortable: false,
      className: 'text-right',
      render: (asset) => (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleDepreciation(asset.id)}
            disabled={loading === asset.id}
            title="ثبت استهلاک"
          >
            <TrendingDown className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-red-500 hover:text-red-600"
            onClick={() => handleDelete(asset.id)}
            title="حذف"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <DataTable
      data={assets}
      columns={columns}
      searchable={true}
      searchPlaceholder="جستجو در دارایی‌ها (نام)..."
      searchKeys={['name']}
      filterable={true}
      filters={[
        {
          key: 'assetType',
          label: 'نوع',
          options: [
            { value: 'FIXED', label: 'دارایی ثابت' },
            { value: 'CONSUMABLE', label: 'کالای مصرفی' },
          ],
        },
      ]}
      defaultSort={{ key: 'purchaseDate', direction: 'desc' }}
      pageSize={15}
      emptyMessage="هنوز دارایی ثبت نشده است"
    />
  );
}

