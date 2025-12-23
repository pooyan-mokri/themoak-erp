'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2, Eye } from 'lucide-react';
import { useState } from 'react';
import { deleteCustomer } from '@/actions/customer';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CustomerForm } from '@/components/sales/customer-form';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  totalDebt?: number;
  segment?: string | null;
}

interface CustomerListProps {
  customers: Customer[];
}

export function CRMCustomerList({ customers }: CustomerListProps) {
  const columns: DataTableColumn<Customer>[] = [
    {
      key: 'name',
      label: 'نام مشتری',
      sortable: true,
      render: (customer) => (
        <Link href={`/dashboard/crm/customers/${customer.id}`} className="hover:underline text-blue-600 font-medium">
          {customer.name}
        </Link>
      ),
    },
    {
      key: 'phone',
      label: 'شماره تماس',
      sortable: true,
      render: (customer) => customer.phone || '-',
    },
    {
      key: 'segment',
      label: 'دسته‌بندی',
      sortable: true,
      render: (customer) =>
        customer.segment ? (
          <span className="px-2 py-1 bg-purple-100 text-purple-800 text-xs rounded-full">
            {customer.segment}
          </span>
        ) : (
          '-'
        ),
    },
    {
      key: 'totalDebt',
      label: 'بدهی کل',
      sortable: true,
      render: (customer) =>
        customer.totalDebt && customer.totalDebt > 0 ? (
          <span className="text-red-600 font-medium">
            {new Intl.NumberFormat('fa-IR').format(customer.totalDebt)} تومان
          </span>
        ) : (
          <span className="text-green-600">تسویه</span>
        ),
    },
    {
      key: 'actions',
      label: 'عملیات',
      sortable: false,
      className: 'text-left',
      render: (customer) => <CustomerActions customer={customer} />,
    },
  ];

  return (
    <DataTable
      data={customers}
      columns={columns}
      searchable={true}
      searchPlaceholder="جستجو در مشتریان (نام، شماره تماس)..."
      searchKeys={['name', 'phone', 'email']}
      filterable={true}
      filters={[
        {
          key: 'segment',
          label: 'دسته‌بندی',
          options: [
            { value: 'VIP', label: 'VIP' },
            { value: 'عادی', label: 'عادی' },
            { value: 'عمده', label: 'عمده' },
          ],
        },
      ]}
      defaultSort={{ key: 'name', direction: 'asc' }}
      pageSize={10}
      emptyMessage="هیچ مشتری یافت نشد."
    />
  );
}

function CustomerActions({ customer }: { customer: Customer }) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    const result = await deleteCustomer(customer.id);
    setIsDeleting(false);
    
    if (result.success) {
      toast.success(result.message);
      setIsDeleteOpen(false);
    } else {
      toast.error(result.message);
    }
  };

  return (
    <div className="flex justify-end gap-2">
      <Link href={`/dashboard/crm/customers/${customer.id}`}>
        <Button variant="ghost" size="icon">
          <Eye className="h-4 w-4 text-gray-500" />
        </Button>
      </Link>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon">
            <Pencil className="h-4 w-4 text-blue-500" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ویرایش مشتری</DialogTitle>
          </DialogHeader>
          <CustomerForm 
            initialData={customer} 
            onSuccess={() => setIsEditOpen(false)} 
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="icon">
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>آیا از حذف این مشتری اطمینان دارید؟</AlertDialogTitle>
            <AlertDialogDescription>
              این عملیات قابل بازگشت نیست. در صورت وجود سفارش، امکان حذف وجود ندارد.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction onClick={(e: React.MouseEvent) => { e.preventDefault(); handleDelete(); }} disabled={isDeleting}>
              {isDeleting ? 'در حال حذف...' : 'حذف'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
