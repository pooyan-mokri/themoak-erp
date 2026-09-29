'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface Supplier {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  _count?: {
    orders: number;
  };
  /** What the supplier owes us back («طلب از تأمین‌کننده»), in Toman; only for finance viewers. */
  creditBalance?: number;
}

interface SupplierListProps {
  suppliers: Supplier[];
  /** stock.manage or finance.manage; the page header carries the «new» button. */
  canCreate: boolean;
  /** Open purchase orders per supplier id. */
  openOrders?: Record<string, number>;
  /** What is still owed per supplier id (Toman); only with finance.view. */
  balances?: Record<string, number>;
}

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Math.round(n));

export function SupplierList({ suppliers, openOrders = {}, balances }: SupplierListProps) {
  const [query, setQuery] = useState('');
  // What a supplier owes us back («طلب از تأمین‌کننده»): sent to finance viewers only.
  const showCredit = suppliers.some((supplier) => supplier.creditBalance !== undefined);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? suppliers.filter((s) => [s.name, s.phone, s.email, s.address].some((field) => field?.toLowerCase().includes(q)))
      : suppliers;
    // Who is owed the most comes first when balances are shown.
    return balances ? [...list].sort((a, b) => (balances[b.id] ?? 0) - (balances[a.id] ?? 0)) : list;
  }, [suppliers, balances, query]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="نام، تلفن یا ایمیل" className="ps-8" />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>نام</TableHead>
              <TableHead>تلفن</TableHead>
              <TableHead>ایمیل</TableHead>
              <TableHead>آدرس</TableHead>
              <TableHead className="text-end">سفارش‌ها</TableHead>
              <TableHead className="text-end">باز</TableHead>
              {balances && <TableHead className="text-end">مانده پرداخت (تومان)</TableHead>}
              {showCredit && <TableHead className="text-end">طلب از تأمین‌کننده (تومان)</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6 + (balances ? 1 : 0) + (showCredit ? 1 : 0)} className="h-24 text-center text-muted-foreground">
                  {suppliers.length === 0
                    ? 'هنوز تامین‌کننده‌ای ثبت نشده است. برای ثبت سفارش خرید، اول تامین‌کننده را تعریف کنید.'
                    : 'تامین‌کننده‌ای با این جستجو پیدا نشد.'}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((supplier) => {
                const balance = balances?.[supplier.id] ?? 0;
                return (
                  <TableRow key={supplier.id}>
                    <TableCell className="font-medium">{supplier.name}</TableCell>
                    <TableCell className="font-mono text-[12px] text-muted-foreground" dir="ltr" style={{ textAlign: 'end' }}>
                      {supplier.phone || '—'}
                    </TableCell>
                    <TableCell className="font-mono text-[12px] text-muted-foreground">{supplier.email || '—'}</TableCell>
                    <TableCell className="max-w-[240px] truncate text-muted-foreground">{supplier.address || '—'}</TableCell>
                    <TableCell className="text-end">{fa(supplier._count?.orders || 0)}</TableCell>
                    <TableCell className="text-end">{openOrders[supplier.id] ? fa(openOrders[supplier.id]) : '—'}</TableCell>
                    {balances && (
                      <TableCell className="text-end">
                        {balance > 0 ? (
                          <span className="font-medium">{fa(balance)}</span>
                        ) : (
                          <span className={cn('rounded-full bg-success-soft px-2 py-0.5 text-[11.5px] text-success')}>تسویه</span>
                        )}
                      </TableCell>
                    )}
                    {showCredit && (
                      <TableCell className="text-end tabular-nums">{supplier.creditBalance ? fa(supplier.creditBalance) : '—'}</TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
