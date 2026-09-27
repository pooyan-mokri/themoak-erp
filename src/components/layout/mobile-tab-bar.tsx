'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { LayoutDashboard, Menu, Plus, Search, ShoppingBag } from 'lucide-react';
import { can, canAccessRoute } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { OPEN_MENU, OPEN_PALETTE } from '@/components/layout/nav-memory';

const tab = 'flex flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px]';

/** Phone bottom bar (design: خانه · سفارش‌ها · + · جستجو · منو). */
export function MobileTabBar() {
  const pathname = usePathname() ?? '';
  const { data: session } = useSession();
  const role = session?.user?.role;
  const showOrders = canAccessRoute(role, '/dashboard/sales/history');
  const showSell = can(role, 'sales.manage') && canAccessRoute(role, '/dashboard/sales/pos');

  const link = (href: string, label: string, Icon: typeof Menu, exact = false) => {
    const on = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link href={href} className={cn(tab, on ? 'text-brand' : 'text-muted-foreground')}>
        <Icon className="h-5 w-5" strokeWidth={1.75} />
        {label}
      </Link>
    );
  };

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden print:hidden">
      {link('/dashboard', 'خانه', LayoutDashboard, true)}
      {showOrders && link('/dashboard/sales/history', 'سفارش‌ها', ShoppingBag)}
      {showSell && (
        <div className="flex flex-1 items-center justify-center">
          <Link
            href="/dashboard/sales/pos"
            title="فروش جدید"
            className="grid h-11 w-11 place-items-center rounded-full bg-brand text-white"
          >
            <Plus className="h-5 w-5" />
          </Link>
        </div>
      )}
      <button type="button" className={cn(tab, 'text-muted-foreground')} onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE))}>
        <Search className="h-5 w-5" strokeWidth={1.75} />
        جستجو
      </button>
      <button type="button" className={cn(tab, 'text-muted-foreground')} onClick={() => window.dispatchEvent(new Event(OPEN_MENU))}>
        <Menu className="h-5 w-5" strokeWidth={1.75} />
        منو
      </button>
    </nav>
  );
}
