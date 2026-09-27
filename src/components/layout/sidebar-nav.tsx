'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  BarChart3,
  Bot,
  Briefcase,
  Calculator,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Package,
  Search,
  Settings,
  ShoppingCart,
  Truck,
  UserCircle,
  Users,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ROLE_LABELS, canAccessRoute, NAV_WHILE_LOADING } from '@/lib/permissions';
import { useLogo } from '@/components/providers/logo-provider';

/**
 * The navigation, shared by the desktop sidebar and the mobile drawer, in the
 * three groups of the design (daily work · buying and selling · tools).
 * Every item is filtered by the signed-in role.
 */
const routes = [
  { group: 0, label: 'داشبورد', icon: LayoutDashboard, href: '/dashboard' },
  { group: 0, label: 'حسابداری', icon: Calculator, href: '/dashboard/accounting' },
  { group: 0, label: 'کارمندان', icon: UserCircle, href: '/dashboard/accounting/employees' },
  { group: 0, label: 'حقوق و دستمزد', icon: Wallet, href: '/dashboard/accounting/payroll' },
  { group: 0, label: 'انبارداری', icon: Package, href: '/dashboard/inventory' },
  { group: 0, label: 'مدیریت ارتباط با مشتری', icon: Users, href: '/dashboard/crm' },
  { group: 0, label: 'فروش', icon: ShoppingCart, href: '/dashboard/sales' },
  { group: 1, label: 'خرید و تامین‌کنندگان', icon: Truck, href: '/dashboard/suppliers' },
  { group: 1, label: 'پروژه‌ها', icon: Briefcase, href: '/dashboard/projects' },
  { group: 1, label: 'بازاریابی', icon: Megaphone, href: '/dashboard/marketing' },
  { group: 2, label: 'گزارشات', icon: BarChart3, href: '/dashboard/reports' },
  { group: 2, label: 'دستیار هوش مصنوعی', icon: Bot, href: '/dashboard/assistant' },
  { group: 2, label: 'جستجو', icon: Search, href: '/dashboard/search' },
  { group: 2, label: 'تنظیمات', icon: Settings, href: '/dashboard/settings' },
];

/** The item a path belongs to: the longest href it starts with (so «داشبورد» is not active everywhere). */
function activeHref(pathname: string, hrefs: string[]): string | undefined {
  return hrefs
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? '';
  const { data: session, status } = useSession();
  const { logo } = useLogo();
  // Until the session loads, show nothing a role might not be allowed to see.
  const visibleRoutes = routes.filter((route) =>
    status === 'loading' ? NAV_WHILE_LOADING.includes(route.href) : canAccessRoute(session?.user?.role, route.href),
  );
  const active = activeHref(pathname, visibleRoutes.map((route) => route.href));
  const role = session?.user?.role as keyof typeof ROLE_LABELS | undefined;
  const name = session?.user?.name ?? '';

  return (
    <div className="flex h-full flex-col bg-card px-3 py-4">
      <Link href="/dashboard" onClick={onNavigate} className="mb-4 flex h-9 items-center ps-1">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="TheMoak" className="h-8 w-auto object-contain" />
        ) : (
          <span className="font-mono text-[15px] tracking-[.04em] text-brand">THEMOAK</span>
        )}
      </Link>

      <nav className="flex-1 overflow-y-auto">
        {visibleRoutes.map((route, index) => (
          <div key={route.href}>
            {index > 0 && visibleRoutes[index - 1].group !== route.group && <div className="my-2 h-px bg-border" />}
            <Link
              href={route.href}
              onClick={onNavigate}
              className={cn(
                'flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-[13.5px] transition-colors duration-150',
                route.href === active
                  ? 'bg-brand-soft font-medium text-brand'
                  : 'text-foreground/80 hover:bg-brand/[.04] hover:text-foreground',
              )}
            >
              <route.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span className="truncate">{route.label}</span>
            </Link>
          </div>
        ))}
      </nav>

      <div className="mt-3 flex items-center gap-2.5 rounded-lg border p-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand font-mono text-xs text-white">
          {name.trim()[0] ?? '·'}
        </span>
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[12.5px] font-medium">{name}</b>
          <small className="block text-[11px] text-muted-foreground">{role ? ROLE_LABELS[role] : ''}</small>
        </span>
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            signOut();
          }}
          title="خروج"
          className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-danger-soft hover:text-danger"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
