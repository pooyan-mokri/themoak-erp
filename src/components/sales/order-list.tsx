'use client';

import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, DollarSign, XCircle, Download, SlidersHorizontal, X } from 'lucide-react';
import Link from 'next/link';
import { formatJalaliDateTime } from '@/lib/date-utils';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';
import { PaymentDialog } from './payment-dialog';
import { cancelOrder } from '@/actions/sales';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { JalaliDatePicker } from '@/components/ui/jalali-date-picker';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';

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
  warehouse?: { id: string; name: string } | null;
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

  // Advanced filter state
  const [showFilters, setShowFilters] = useState(false);
  const [filterFromDate, setFilterFromDate] = useState<Date | undefined>();
  const [filterToDate, setFilterToDate] = useState<Date | undefined>();
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterPaymentStatus, setFilterPaymentStatus] = useState('all');
  const [filterMinAmount, setFilterMinAmount] = useState('');
  const [filterMaxAmount, setFilterMaxAmount] = useState('');
  const [filterWarehouse, setFilterWarehouse] = useState('all');

  // Derive unique warehouses from orders
  const warehouses = useMemo(() => {
    const map = new Map<string, string>();
    orders.forEach((o) => o.items.forEach((item) => {
      if (item.warehouse) map.set(item.warehouse.id, item.warehouse.name);
    }));
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [orders]);

  const hasActiveFilters = filterFromDate || filterToDate || filterCustomer || filterPaymentStatus !== 'all' || filterMinAmount || filterMaxAmount || filterWarehouse !== 'all';

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      if (filterFromDate) {
        const from = new Date(filterFromDate); from.setHours(0, 0, 0, 0);
        if (new Date(order.createdAt) < from) return false;
      }
      if (filterToDate) {
        const to = new Date(filterToDate); to.setHours(23, 59, 59, 999);
        if (new Date(order.createdAt) > to) return false;
      }
      if (filterCustomer && !order.customer?.name?.toLowerCase().includes(filterCustomer.toLowerCase())) return false;
      if (filterPaymentStatus !== 'all' && order.paymentStatus !== filterPaymentStatus) return false;
      const finalAmount = Number(order.totalAmount) - Number(order.discount || 0);
      if (filterMinAmount && finalAmount < Number(filterMinAmount)) return false;
      if (filterMaxAmount && finalAmount > Number(filterMaxAmount)) return false;
      if (filterWarehouse !== 'all' && !order.items.some((item) => item.warehouse?.id === filterWarehouse)) return false;
      return true;
    });
  }, [orders, filterFromDate, filterToDate, filterCustomer, filterPaymentStatus, filterMinAmount, filterMaxAmount, filterWarehouse]);

  const resetFilters = () => {
    setFilterFromDate(undefined);
    setFilterToDate(undefined);
    setFilterCustomer('');
    setFilterPaymentStatus('all');
    setFilterMinAmount('');
    setFilterMaxAmount('');
    setFilterWarehouse('all');
  };

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
      label: 'قیمت نهایی',
      sortable: true,
      render: (order) => {
        const final = Number(order.totalAmount) - Number(order.discount || 0);
        return (
          <span>
            {final.toLocaleString('fa-IR')} تومان
            {Number(order.discount || 0) > 0 && (
              <span className="text-xs text-gray-400 line-through mr-1">
                {Number(order.totalAmount).toLocaleString('fa-IR')}
              </span>
            )}
          </span>
        );
      },
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
        const finalAmount = Number(order.totalAmount) - Number(order.discount || 0);
        const remaining = finalAmount - Number(order.paidAmount || 0);
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
      {/* Toolbar */}
      <div className="flex justify-between items-center mb-4 gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant={showFilters ? 'default' : 'outline'}
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2"
          >
            <SlidersHorizontal className="h-4 w-4" />
            فیلتر پیشرفته
            {hasActiveFilters && (
              <Badge variant="destructive" className="h-5 w-5 p-0 flex items-center justify-center text-xs">
                !
              </Badge>
            )}
          </Button>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1 text-muted-foreground">
              <X className="h-3 w-3" />
              پاک‌کردن فیلترها
            </Button>
          )}
          {hasActiveFilters && (
            <span className="text-sm text-muted-foreground">
              {filteredOrders.length} از {orders.length} سفارش
            </span>
          )}
        </div>
        <Button
          onClick={handleExportToExcel}
          variant="outline"
          className="bg-green-50 hover:bg-green-100 text-green-700 border-green-200"
        >
          <Download className="ml-2 h-4 w-4" />
          دانلود Excel
        </Button>
      </div>

      {/* Advanced Filter Panel */}
      {showFilters && (
        <Card className="mb-4 border-blue-200 bg-blue-50/30">
          <CardContent className="pt-4 pb-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <JalaliDatePicker
                name="filterFrom"
                label="از تاریخ"
                onChange={(d) => setFilterFromDate(d)}
                defaultValue={filterFromDate}
                placeholder="انتخاب تاریخ شروع"
              />
              <JalaliDatePicker
                name="filterTo"
                label="تا تاریخ"
                onChange={(d) => setFilterToDate(d)}
                defaultValue={filterToDate}
                placeholder="انتخاب تاریخ پایان"
              />
              <div className="space-y-1.5">
                <Label className="text-sm">نام مشتری</Label>
                <Input
                  placeholder="جستجو در مشتریان..."
                  value={filterCustomer}
                  onChange={(e) => setFilterCustomer(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">وضعیت پرداخت</Label>
                <Select value={filterPaymentStatus} onValueChange={setFilterPaymentStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">همه</SelectItem>
                    <SelectItem value="PAID">پرداخت شده</SelectItem>
                    <SelectItem value="PARTIAL">پرداخت جزئی</SelectItem>
                    <SelectItem value="UNPAID">پرداخت نشده</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">حداقل مبلغ (تومان)</Label>
                <Input
                  type="number"
                  placeholder="مثلاً ۵۰۰۰۰۰"
                  value={filterMinAmount}
                  onChange={(e) => setFilterMinAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">حداکثر مبلغ (تومان)</Label>
                <Input
                  type="number"
                  placeholder="مثلاً ۱۰۰۰۰۰۰"
                  value={filterMaxAmount}
                  onChange={(e) => setFilterMaxAmount(e.target.value)}
                />
              </div>
              {warehouses.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-sm">انبار</Label>
                  <Select value={filterWarehouse} onValueChange={setFilterWarehouse}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">همه انبارها</SelectItem>
                      {warehouses.map((w) => (
                        <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <DataTable
        data={filteredOrders}
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
