import Link from 'next/link';
import { Plus } from 'lucide-react';
import { getPurchaseOrders, getSuppliers } from '@/actions/supplier';
import { PageHeader } from '@/components/layout/page-header';
import { SectionCard } from '@/components/dashboard/section-card';
import { Button } from '@/components/ui/button';
import { PurchaseKpis } from '@/components/suppliers/purchase-kpis';
import { isOpen, payableOf, purchaseFigures, purchaseStatus, supplierBalances } from '@/components/suppliers/purchase-figures';
import { formatJalaliDate } from '@/lib/date-utils';
import { hasPermission, requireRouteAccess } from '@/lib/access';
import { cn } from '@/lib/utils';

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Math.round(n));

/** Purchasing at a glance: the figures, the orders still open and what each supplier is owed. */
export default async function SuppliersDashboard() {
  await requireRouteAccess('/dashboard/suppliers');
  const [canCreateOrder, canSeeFinance, { data: orders }, { data: suppliers }] = await Promise.all([
    hasPermission('cost.edit'),
    hasPermission('finance.view'),
    getPurchaseOrders(),
    getSuppliers(),
  ]);
  const list: any[] = orders || [];
  const open = list.filter(isOpen);
  const balances = canSeeFinance ? supplierBalances(list) : undefined;
  const owed = balances
    ? (suppliers || []).filter((s: any) => (balances[s.id] ?? 0) > 0).sort((a: any, b: any) => balances[b.id] - balances[a.id])
    : [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="خرید و تامین‌کنندگان"
        description={`${fa((suppliers || []).length)} تامین‌کننده · ${fa(list.length)} سفارش خرید`}
        actions={
          canCreateOrder && (
            <Button asChild>
              <Link href="/dashboard/suppliers/orders/new">
                <Plus className="h-4 w-4" />
                سفارش خرید جدید
              </Link>
            </Button>
          )
        }
      />

      <PurchaseKpis figures={purchaseFigures(list)} />

      <div className={cn('grid gap-4', balances && 'lg:grid-cols-[1fr_360px]')}>
        <SectionCard title="سفارش‌های باز" count={fa(open.length)} link={{ href: '/dashboard/suppliers/orders', label: 'همه سفارش‌ها' }}>
          {open.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted-foreground">سفارش بازی نیست؛ همهٔ سفارش‌ها دریافت یا لغو شده‌اند.</p>
          ) : (
            <ul className="divide-y">
              {open.slice(0, 8).map((order: any) => {
                const s = purchaseStatus(order.status);
                const remaining = payableOf(order);
                return (
                  <li key={order.id} className="flex items-center gap-3 py-2">
                    <Link href={`/dashboard/suppliers/orders/${order.id}`} className="font-mono text-[13px] font-bold hover:text-brand">
                      PO-{order.number}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-[13px]">{order.supplier.name}</span>
                    {remaining !== undefined && remaining > 0 && (
                      <span className="text-[12px] tabular-nums text-muted-foreground">مانده {fa(remaining)}</span>
                    )}
                    <span className="hidden font-mono text-[11.5px] text-muted-foreground sm:inline">{formatJalaliDate(order.createdAt)}</span>
                    <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px]', s.tone)}>{s.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        {balances && (
          <SectionCard title="مانده تامین‌کنندگان" link={{ href: '/dashboard/suppliers/management', label: 'همه تامین‌کنندگان' }}>
            {owed.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-muted-foreground">مانده پرداختی به هیچ تامین‌کننده‌ای نیست.</p>
            ) : (
              <ul className="divide-y">
                {owed.slice(0, 8).map((supplier: any) => (
                  <li key={supplier.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate text-[13px]">{supplier.name}</span>
                    <span className="text-[13.5px] font-medium tabular-nums">
                      {fa(balances[supplier.id])}
                      <small className="ms-1 text-[11px] font-normal text-muted-foreground">تومان</small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        )}
      </div>
    </div>
  );
}
