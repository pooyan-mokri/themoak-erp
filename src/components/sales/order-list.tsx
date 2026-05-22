'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eye, DollarSign, XCircle, Download } from 'lucide-react';
import Link from 'next/link';
import { formatJalaliDateTime } from '@/lib/date-utils';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';
import { PaymentDialog } from './payment-dialog';
import { cancelOrder } from '@/actions/sales';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';

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

type Product = {
  id: string;
  name: string;
  sku: string;
  costPrice: number;
  sellPrice: number;
  image?: string;
  wooId?: number;
  barcode?: string;
  createdAt: Date;
  updatedAt: Date;
  productType: string;
};

type OrderItem = {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  price: number;
  status: string;
  product: Product;
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
  tags?: string[];
  customer?: Customer;
  items: OrderItem[];
};

interface OrderListProps {
  orders: OrderWithDetails[];
}

export function OrderList({ orders }: OrderListProps) {
  const [selectedOrder, setSelectedOrder] = useState<OrderWithDetails | null>(null);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const router = useRouter();

  const handlePaymentClick = (order: OrderWithDetails) => {
    setSelectedOrder(order);
    setIsPaymentDialogOpen(true);
  };

  const handleCancelOrder = async (order: OrderWithDetails) => {
    // Confirm with user
    const confirmed = window.confirm(
      `آیا مطمئن هستید که می‌خواهید سفارش #${order.number} را لغو کنید؟\n\n` +
      `این عملیات:\n` +
      `- وضعیت سفارش را به "لغو شده" تغییر می‌دهد\n` +
      `- پرداخت‌ها را لغو و موجودی حساب را بازگردانی می‌کند\n` +
      (order.wooId ? `- سفارش را در WooCommerce هم لغو می‌کند\n` : '')
    );

    if (!confirmed) return;

    const result = await cancelOrder(order.id);

    if (result.success) {
      toast.success(result.message);
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  const handleExportToExcel = () => {
    // Prepare data for Excel
    const excelData = orders.map((order) => ({
      'شماره سفارش': order.number,
      'مشتری': order.customer?.name || 'مشتری عمومی',
      'مبلغ کل (تومان)': Number(order.totalAmount),
      'تخفیف (تومان)': Number(order.discount || 0),
      'مبلغ پرداختی (تومان)': Number(order.paidAmount || 0),
      'باقیمانده (تومان)': Number(order.totalAmount) - Number(order.paidAmount || 0),
      'وضعیت پرداخت': order.paymentStatus === 'PAID' ? 'پرداخت شده' :
                      order.paymentStatus === 'PARTIAL' ? 'پرداخت جزئی' : 'پرداخت نشده',
      'تعداد اقلام': order.items.reduce((acc, item) => acc + item.quantity, 0),
      'وضعیت سفارش': order.status === 'COMPLETED' ? 'تکمیل شده' :
                     order.status === 'CANCELLED' ? 'لغو شده' : 'در انتظار',
      'تاریخ': formatJalaliDateTime(order.createdAt),
      'منبع': order.wooId ? 'WooCommerce' : 'سیستم',
    }));

    // Create worksheet
    const ws = XLSX.utils.json_to_sheet(excelData);

    // Set column widths
    const colWidths = [
      { wch: 12 }, // شماره سفارش
      { wch: 20 }, // مشتری
      { wch: 15 }, // مبلغ کل
      { wch: 15 }, // تخفیف
      { wch: 15 }, // مبلغ پرداختی
      { wch: 15 }, // باقیمانده
      { wch: 15 }, // وضعیت پرداخت
      { wch: 12 }, // تعداد اقلام
      { wch: 15 }, // وضعیت سفارش
      { wch: 20 }, // تاریخ
      { wch: 15 }, // منبع
    ];
    ws['!cols'] = colWidths;

    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'سفارشات');

    // Generate filename with current date
    const now = new Date();
    const filename = `سفارشات-${now.toLocaleDateString('fa-IR').replace(/\//g, '-')}.xlsx`;

    // Download
    XLSX.writeFile(wb, filename);

    toast.success('فایل اکسل با موفقیت دانلود شد');
  };

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
      key: 'paidAmount',
      label: 'مبلغ پرداختی',
      sortable: true,
      render: (order) => `${Number(order.paidAmount || 0).toLocaleString('fa-IR')} تومان`,
    },
    {
      key: 'remainingAmount',
      label: 'باقیمانده',
      sortable: true,
      render: (order) => {
        // totalAmount قبلاً تخفیف را کم کرده (در WooCommerce: total = subtotal - discount)
        const remaining = Number(order.totalAmount) - Number(order.paidAmount || 0);
        return (
          <span className={remaining > 0 ? 'text-red-600 font-semibold' : 'text-green-600'}>
            {remaining.toLocaleString('fa-IR')} تومان
          </span>
        );
      },
    },
    {
      key: 'paymentStatus',
      label: 'وضعیت پرداخت',
      sortable: true,
      render: (order) => {
        const variant =
          order.paymentStatus === 'PAID'
            ? 'default'
            : order.paymentStatus === 'PARTIAL'
            ? 'secondary'
            : 'destructive';
        const label =
          order.paymentStatus === 'PAID'
            ? 'پرداخت شده'
            : order.paymentStatus === 'PARTIAL'
            ? 'پرداخت جزئی'
            : 'پرداخت نشده';
        return <Badge variant={variant}>{label}</Badge>;
      },
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
      render: (order) => {
        const statusLabels: Record<string, string> = {
          COMPLETED: 'تکمیل شده',
          PENDING: 'در انتظار',
          CANCELLED: 'لغو شده',
        };
        const variant =
          order.status === 'COMPLETED' ? 'default' :
          order.status === 'CANCELLED' ? 'destructive' :
          'secondary';
        return (
          <Badge variant={variant}>
            {statusLabels[order.status] || order.status}
          </Badge>
        );
      },
    },
    {
      key: 'tags',
      label: 'تگ‌ها',
      sortable: false,
      render: (order) =>
        order.tags && order.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {order.tags.map((tag, i) => (
              <Badge key={i} variant="outline" className="text-xs px-1.5 py-0">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null,
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
        <div className="flex items-center gap-2">
          {/* فقط برای سفارشات غیرلغوشده دکمه پرداخت نمایش داده می‌شود */}
          {(order.paymentStatus === 'UNPAID' || order.paymentStatus === 'PARTIAL') &&
           order.status !== 'CANCELLED' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePaymentClick(order)}
              className="bg-green-50 hover:bg-green-100 text-green-700 border-green-200"
            >
              <DollarSign className="mr-2 h-4 w-4" />
              ثبت پرداخت
            </Button>
          )}
          <Link href={`/dashboard/sales/history/${order.id}`}>
            <Button variant="outline" size="sm">
              <Eye className="mr-2 h-4 w-4" />
              جزئیات
            </Button>
          </Link>
          {/* دکمه لغو فقط برای سفارشات غیرلغوشده */}
          {order.status !== 'CANCELLED' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleCancelOrder(order)}
              className="bg-red-50 hover:bg-red-100 text-red-700 border-red-200"
            >
              <XCircle className="mr-2 h-4 w-4" />
              لغو
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button
          onClick={handleExportToExcel}
          variant="outline"
          className="bg-green-50 hover:bg-green-100 text-green-700 border-green-200"
        >
          <Download className="ml-2 h-4 w-4" />
          دانلود Excel
        </Button>
      </div>

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
          {
            key: 'paymentStatus',
            label: 'وضعیت پرداخت',
            options: [
              { value: 'PAID', label: 'پرداخت شده' },
              { value: 'PARTIAL', label: 'پرداخت جزئی' },
              { value: 'UNPAID', label: 'پرداخت نشده' },
            ],
          },
        ]}
        defaultSort={{ key: 'createdAt', direction: 'desc' }}
        pageSize={10}
        emptyMessage="هیچ سفارشی یافت نشد."
      />

      {selectedOrder && (
        <PaymentDialog
          order={selectedOrder}
          open={isPaymentDialogOpen}
          onOpenChange={setIsPaymentDialogOpen}
        />
      )}
    </>
  );
}
