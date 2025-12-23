'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Calculator,
  Package,
  ShoppingCart,
  Truck,
  Briefcase,
  Settings,
  LogOut,
  Users,
  BarChart3,
  Megaphone,
  Store,
  UserCircle,
  Wallet,
  Bot,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { signOut } from 'next-auth/react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Logo } from './logo';

const routes = [
  {
    label: 'داشبورد',
    icon: LayoutDashboard,
    href: '/dashboard',
    color: 'text-sky-500',
  },
  {
    label: 'حسابداری',
    icon: Calculator,
    href: '/dashboard/accounting',
    color: 'text-violet-500',
  },
  {
    label: 'کارمندان',
    icon: UserCircle,
    href: '/dashboard/accounting/employees',
    color: 'text-blue-400',
  },
  {
    label: 'حقوق و دستمزد',
    icon: Wallet,
    href: '/dashboard/accounting/payroll',
    color: 'text-green-400',
  },
  {
    label: 'انبارداری',
    icon: Package,
    href: '/dashboard/inventory',
    color: 'text-pink-700',
  },
  {
    label: 'مدیریت ارتباط با مشتری',
    icon: Users,
    href: '/dashboard/crm',
    color: 'text-blue-500',
  },
  {
    label: 'فروش',
    icon: ShoppingCart,
    href: '/dashboard/sales',
    color: 'text-orange-700',
  },
  {
    label: 'خرید و تامین‌کنندگان',
    icon: Truck,
    href: '/dashboard/suppliers',
    color: 'text-emerald-500',
  },
  {
    label: 'پروژه‌ها',
    icon: Briefcase,
    href: '/dashboard/projects',
    color: 'text-green-700',
  },
  {
    label: 'بازاریابی',
    icon: Megaphone,
    href: '/dashboard/marketing',
    color: 'text-pink-600',
  },
  {
    label: 'WooCommerce',
    icon: Store,
    href: '/dashboard/woocommerce',
    color: 'text-amber-600',
  },
  {
    label: 'گزارشات',
    icon: BarChart3,
    href: '/dashboard/reports',
    color: 'text-purple-600',
  },
  {
    label: 'دستیار هوش مصنوعی',
    icon: Bot,
    href: '/dashboard/assistant',
    color: 'text-cyan-500',
  },
  {
    label: 'تنظیمات',
    icon: Settings,
    href: '/dashboard/settings',
  },
];

interface MobileMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MobileMenu({ open, onOpenChange }: MobileMenuProps) {
  const pathname = usePathname();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[280px] sm:w-[320px] bg-[#111827] text-white p-0">
        <SheetHeader className="p-4 border-b border-white/10">
          <SheetTitle className="text-right">
            <Link href="/dashboard" onClick={() => onOpenChange(false)}>
              <Logo />
            </Link>
          </SheetTitle>
        </SheetHeader>
        <div className="flex flex-col h-[calc(100vh-80px)]">
          <ScrollArea className="flex-1 p-3">
            <div className="space-y-1">
              {routes.map((route) => (
                <Link
                  key={route.href}
                  href={route.href}
                  onClick={() => onOpenChange(false)}
                  className={cn(
                    'text-sm group flex p-3 w-full justify-start font-medium cursor-pointer hover:text-white hover:bg-white/10 rounded-lg transition',
                    pathname === route.href || (route.href !== '/dashboard/accounting' && pathname?.startsWith(route.href)) 
                      ? 'text-white bg-white/10' 
                      : 'text-zinc-400'
                  )}
                >
                  <div className="flex items-center flex-1">
                    <route.icon className={cn('h-5 w-5 ml-3', route.color)} />
                    {route.label}
                  </div>
                </Link>
              ))}
            </div>
          </ScrollArea>
          <div className="p-3 border-t border-white/10 flex-shrink-0">
            <Button 
              onClick={() => {
                onOpenChange(false);
                signOut();
              }}
              variant="destructive" 
              className="w-full justify-start"
            >
              <LogOut className="h-5 w-5 ml-3" />
              خروج
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

