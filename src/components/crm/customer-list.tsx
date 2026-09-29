'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Eye, Pencil, Search, Trash2 } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
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
} from '@/components/ui/alert-dialog';
import { CustomerForm } from '@/components/sales/customer-form';
import { deleteCustomer } from '@/actions/customer';
import type { CustomerOrderSummary } from '@/actions/customer';
import { cn } from '@/lib/utils';
import { PILL, SEGMENTS, fa } from './crm-labels';

interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  totalDebt?: number;
  totalCredit?: number;
  segment?: string;
}

interface CustomerListProps {
  customers: Customer[];
  /** Orders not cancelled and their net worth, by customer id. */
  summaries?: Record<string, CustomerOrderSummary>;
  /** May edit and delete (sales.manage); the server checks it again. */
  canManage?: boolean;
}

type SortKey = 'name' | 'orders' | 'value' | 'debt';
const PAGE_SIZE = 25;
const NONE = '__none__';

export function CRMCustomerList({ customers, summaries = {}, canManage = false }: CustomerListProps) {
  const [segment, setSegment] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'value', dir: 'desc' });
  const [page, setPage] = useState(0);

  const ordersOf = (c: Customer) => summaries[c.id]?.orders ?? 0;
  const valueOf = (c: Customer) => summaries[c.id]?.lifetimeValue ?? 0;

  // The ERP's segment values first, then any other value in the data, then «none».
  const chips = useMemo(() => {
    const values = [...SEGMENTS, ...Array.from(new Set(customers.map((c) => c.segment).filter((s): s is string => !!s && !SEGMENTS.includes(s))))];
    const list = [
      { id: 'all', label: 'همه', count: customers.length },
      ...values.map((value) => ({ id: value, label: value, count: customers.filter((c) => c.segment === value).length })),
    ];
    const none = customers.filter((c) => !c.segment).length;
    return none > 0 ? [...list, { id: NONE, label: 'بدون دسته', count: none }] : list;
  }, [customers]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = customers.filter((c) => {
      if (segment === NONE ? !!c.segment : segment !== 'all' && c.segment !== segment) return false;
      if (!q) return true;
      return [c.name, c.phone, c.email].some((field) => field?.toLowerCase().includes(q));
    });
    const value = (c: Customer): number | string =>
      sort.key === 'name' ? c.name : sort.key === 'orders' ? ordersOf(c) : sort.key === 'value' ? valueOf(c) : c.totalDebt ?? 0;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => (value(a) > value(b) ? 1 : value(a) < value(b) ? -1 : 0) * dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, summaries, segment, query, sort]);

  useEffect(() => setPage(0), [segment, query, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const SortHead = ({ k, children, end }: { k: SortKey; children: React.ReactNode; end?: boolean }) => (
    <th className={cn('h-9 bg-secondary px-3 text-xs font-normal text-muted-foreground', end ? 'text-end' : 'text-start')}>
      <button
        type="button"
        onClick={() => setSort((s) => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }))}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {children}
        {sort.key === k && (sort.dir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => setSegment(chip.id)}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors duration-150',
              segment === chip.id ? 'border-foreground bg-foreground text-white' : 'bg-card hover:border-foreground/40',
            )}
          >
            {chip.label}
            <span className="font-mono text-[11px] opacity-70">{fa(chip.count)}</span>
          </button>
        ))}
        <div className="flex-1" />
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="نام، تلفن یا ایمیل" className="ps-8" />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b">
                <SortHead k="name">مشتری</SortHead>
                <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">تلفن</th>
                <th className="h-9 bg-secondary px-3 text-start text-xs font-normal text-muted-foreground">دسته</th>
                <SortHead k="orders" end>سفارش</SortHead>
                <SortHead k="value" end>ارزش خرید (تومان)</SortHead>
                <SortHead k="debt" end>بدهی (تومان)</SortHead>
                <th className="h-9 bg-secondary px-3" />
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="h-24 text-center text-[13px] text-muted-foreground">
                    {customers.length === 0 ? (
                      'هنوز مشتری‌ای ثبت نشده است. مشتری‌ها با فروش در صندوق، سفارش سایت یا «مشتری جدید» اضافه می‌شوند.'
                    ) : (
                      <>
                        مشتری‌ای با این دسته و جستجو پیدا نشد.{' '}
                        <button
                          className="text-brand hover:underline"
                          onClick={() => {
                            setSegment('all');
                            setQuery('');
                          }}
                        >
                          نمایش همه
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )}
              {pageRows.map((customer) => (
                <tr key={customer.id} className="h-11 border-b transition-colors duration-150 last:border-0 hover:bg-brand/[.04]">
                  <td className="max-w-[220px] truncate px-3">
                    <Link href={`/dashboard/crm/customers/${customer.id}`} className="font-medium hover:text-brand hover:underline">
                      {customer.name}
                    </Link>
                  </td>
                  <td className="px-3 font-mono text-[12px] text-muted-foreground" dir="ltr" style={{ textAlign: 'end' }}>
                    {customer.phone || '—'}
                  </td>
                  <td className="px-3">
                    {customer.segment ? (
                      <span className={cn(PILL, customer.segment === 'VIP' ? 'bg-brand-soft text-brand' : 'bg-secondary text-muted-foreground')}>
                        {customer.segment}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 text-end tabular-nums">{ordersOf(customer) ? fa(ordersOf(customer)) : '—'}</td>
                  <td className="px-3 text-end font-medium tabular-nums">{valueOf(customer) ? fa(valueOf(customer)) : '—'}</td>
                  <td className="px-3 text-end tabular-nums">
                    {customer.totalDebt && customer.totalDebt > 0 ? (
                      fa(Math.round(customer.totalDebt))
                    ) : (
                      <span className={cn(PILL, 'bg-success-soft text-success')}>تسویه</span>
                    )}
                    {customer.totalCredit && customer.totalCredit > 0 ? (
                      <div className="text-[11.5px] text-muted-foreground">بستانکار: {fa(Math.round(customer.totalCredit))}</div>
                    ) : null}
                  </td>
                  <td className="px-3">
                    <CustomerActions customer={customer} canManage={canManage} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between border-t px-3 py-2 text-[12.5px] text-muted-foreground">
            <span>
              {fa(page * PAGE_SIZE + 1)} تا {fa(Math.min(rows.length, (page + 1) * PAGE_SIZE))} از {fa(rows.length)}
            </span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                قبلی
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
                بعدی
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CustomerActions({ customer, canManage }: { customer: Customer; canManage: boolean }) {
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
    <div className="flex justify-end gap-0.5">
      <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="پروندهٔ مشتری">
        <Link href={`/dashboard/crm/customers/${customer.id}`}>
          <Eye className="h-4 w-4 text-muted-foreground" />
        </Link>
      </Button>

      {canManage && (
        <>
          <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" title="ویرایش">
                <Pencil className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>ویرایش مشتری — {customer.name}</DialogTitle>
              </DialogHeader>
              <CustomerForm initialData={customer} onSuccess={() => setIsEditOpen(false)} />
            </DialogContent>
          </Dialog>

          <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-danger" title="حذف">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>حذف «{customer.name}»</AlertDialogTitle>
                <AlertDialogDescription>
                  این عملیات قابل بازگشت نیست. در صورت وجود سفارش، امکان حذف وجود ندارد.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>انصراف</AlertDialogCancel>
                <AlertDialogAction
                  className={buttonVariants({ variant: 'destructive' })}
                  onClick={(e: React.MouseEvent) => {
                    e.preventDefault();
                    handleDelete();
                  }}
                  disabled={isDeleting}
                >
                  {isDeleting ? 'در حال حذف...' : `حذف ${customer.name}`}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
