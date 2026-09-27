'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { Command as CommandPrimitive } from 'cmdk';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  Boxes,
  Briefcase,
  Calculator,
  Clock,
  FileText,
  FolderPlus,
  Gift,
  Handshake,
  LayoutDashboard,
  Loader2,
  Megaphone,
  Moon,
  Package,
  PackagePlus,
  Receipt,
  Search,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Sun,
  Truck,
  UserCircle,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { globalSearch, type SearchResult } from '@/actions/search';
import { can, canAccessRoute, type Permission } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { OPEN_PALETTE, useNavMemory } from '@/components/layout/nav-memory';
import { shortcutFor } from '@/components/layout/shortcuts';

type Destination = { label: string; href: string; icon: LucideIcon; words?: string };
type CreateAction = Destination & { permissions?: readonly Permission[] };
type Item = { id: string; label: string; icon: LucideIcon; hint?: string; sub?: string; amount?: string; run: () => void };

const DESTINATIONS: Destination[] = [
  { label: 'داشبورد', href: '/dashboard', icon: LayoutDashboard, words: 'خانه' },
  { label: 'سفارش‌ها', href: '/dashboard/sales/history', icon: ShoppingBag, words: 'فروش فاکتور' },
  { label: 'صندوق فروش (POS)', href: '/dashboard/sales/pos', icon: ShoppingCart, words: 'pos فروش' },
  { label: 'انبارداری', href: '/dashboard/inventory', icon: Package, words: 'موجودی' },
  { label: 'کالاها', href: '/dashboard/inventory/products', icon: Boxes, words: 'محصول' },
  { label: 'حسابداری', href: '/dashboard/accounting', icon: Calculator },
  { label: 'دفتر روزنامه (تراکنش‌ها)', href: '/dashboard/accounting/transactions', icon: FileText, words: 'ژورنال' },
  { label: 'حساب‌ها', href: '/dashboard/accounting/accounts', icon: Wallet, words: 'بانک صندوق' },
  { label: 'مشتری‌ها', href: '/dashboard/crm/customers', icon: Users },
  { label: 'امانی', href: '/dashboard/consignment', icon: Handshake, words: 'همکار تسویه' },
  { label: 'خرید و تامین‌کنندگان', href: '/dashboard/suppliers', icon: Truck },
  { label: 'کارمندان', href: '/dashboard/accounting/employees', icon: UserCircle },
  { label: 'حقوق و دستمزد', href: '/dashboard/accounting/payroll', icon: Wallet, words: 'فیش' },
  { label: 'پروژه‌ها', href: '/dashboard/projects', icon: Briefcase, words: 'وظیفه' },
  { label: 'بازاریابی', href: '/dashboard/marketing', icon: Megaphone },
  { label: 'گزارشات', href: '/dashboard/reports', icon: BarChart3 },
  { label: 'دستیار هوش مصنوعی', href: '/dashboard/assistant', icon: Bot },
  { label: 'تنظیمات', href: '/dashboard/settings', icon: Settings },
];

/** New entries; each needs the permission its form's action checks. */
const CREATE: CreateAction[] = [
  { label: 'فروش جدید', href: '/dashboard/sales/pos', icon: ShoppingCart, permissions: ['sales.manage'] },
  { label: 'ثبت هزینه', href: '/dashboard/accounting/expenses/new', icon: Receipt, permissions: ['finance.manage'] },
  { label: 'ثبت واریز', href: '/dashboard/accounting/deposits/new', icon: ArrowDownLeft, permissions: ['finance.manage'] },
  { label: 'پرداخت جدید', href: '/dashboard/accounting/withdrawals/new', icon: ArrowUpRight, permissions: ['finance.manage'] },
  { label: 'انتقال داخلی', href: '/dashboard/accounting/transfers/new', icon: ArrowLeftRight, permissions: ['finance.manage'] },
  { label: 'افزودن کالا', href: '/dashboard/inventory/products/new', icon: PackagePlus, permissions: ['stock.manage'] },
  { label: 'مشتری جدید', href: '/dashboard/crm/customers/new', icon: UserPlus, permissions: ['sales.manage'] },
  { label: 'سفارش خرید', href: '/dashboard/suppliers/orders/new', icon: Truck, permissions: ['cost.edit'] },
  { label: 'ثبت هدیه', href: '/dashboard/marketing/gifts/new', icon: Gift, permissions: ['sales.manage'] },
  { label: 'پروژه جدید', href: '/dashboard/projects/new', icon: FolderPlus },
];

const RESULT_ICONS: Record<SearchResult['type'], LucideIcon> = {
  order: ShoppingBag,
  customer: Users,
  product: Package,
  transaction: FileText,
  purchase: Truck,
};

const matches = (needle: string, ...texts: (string | undefined)[]) =>
  !needle || texts.some((text) => text?.toLowerCase().includes(needle));

/** ⌘K anywhere, or the header's search button: go anywhere, start an entry, find a record. */
export function CommandPalette() {
  const router = useRouter();
  const { data: session } = useSession();
  const { resolvedTheme, setTheme } = useTheme();
  const role = session?.user?.role;
  const { recent } = useNavMemory(session?.user?.id);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, startSearch] = useTransition();
  const latest = useRef('');
  const canSearch = canAccessRoute(role, '/dashboard/search');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_PALETTE, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_PALETTE, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
    }
  }, [open]);

  // Records, once two letters are typed; a late answer to an older query is dropped.
  useEffect(() => {
    const q = query.trim();
    latest.current = q;
    if (!canSearch || q.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      startSearch(async () => {
        const found = await globalSearch(q).catch(() => []);
        if (latest.current === q) setResults(found);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, canSearch]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const allowed = (href: string) => canAccessRoute(role, href);
    const out: { heading: string; items: Item[] }[] = [];

    if (!needle) {
      const recentItems = recent.filter((entry) => allowed(entry.href)).slice(0, 3);
      out.push({
        heading: 'اخیر',
        items: recentItems.map((entry) => ({
          id: `recent:${entry.href}`,
          label: entry.label,
          icon: Clock,
          run: () => go(entry.href),
        })),
      });
    }

    out.push({
      heading: 'رفتن به',
      items: DESTINATIONS.filter((d) => allowed(d.href) && matches(needle, d.label, d.words)).map((d) => ({
        id: `go:${d.href}`,
        label: d.label,
        icon: d.icon,
        hint: shortcutFor(d.href),
        run: () => go(d.href),
      })),
    });

    out.push({
      heading: 'ثبت',
      items: CREATE.filter(
        (c) =>
          allowed(c.href) &&
          (!c.permissions || c.permissions.some((p) => can(role, p))) &&
          matches(needle, c.label, 'جدید ثبت'),
      ).map((c) => ({ id: `new:${c.href}:${c.label}`, label: c.label, icon: c.icon, run: () => go(c.href) })),
    });

    if (results.length > 0) {
      out.push({
        heading: 'نتایج',
        items: results.map((r) => ({
          id: `result:${r.type}:${r.id}`,
          label: r.title,
          sub: r.subtitle,
          icon: RESULT_ICONS[r.type],
          amount: r.amount != null ? `${r.amount.toLocaleString('fa-IR')}${r.currency === 'USD' ? ' $' : ''}` : undefined,
          run: () => go(r.href),
        })),
      });
    }

    if (canSearch && needle.length >= 2) {
      out.push({
        heading: 'جستجو',
        items: [
          {
            id: 'search:all',
            label: `همه‌ی نتایج «${query.trim()}»`,
            icon: Search,
            run: () => go(`/dashboard/search?q=${encodeURIComponent(query.trim())}`),
          },
        ],
      });
    }

    const dark = resolvedTheme === 'dark';
    if (matches(needle, 'تم تیره روشن', dark ? 'تم روشن' : 'تم تیره')) {
      out.push({
        heading: 'نمایش',
        items: [
          {
            id: 'theme',
            label: dark ? 'تم روشن' : 'تم تیره',
            icon: dark ? Sun : Moon,
            run: () => {
              setTheme(dark ? 'light' : 'dark');
              setOpen(false);
            },
          },
        ],
      });
    }

    return out.filter((group) => group.items.length > 0);
    // go only closes the dialog and routes; it needs no dependency of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, results, recent, role, canSearch, resolvedTheme]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[12vh] max-w-[640px] translate-y-0 gap-0 overflow-hidden p-0 [&>button:last-child]:hidden">
        <VisuallyHidden.Root>
          <DialogTitle>جستجو و دستورها</DialogTitle>
        </VisuallyHidden.Root>
        <CommandPrimitive shouldFilter={false} loop className="flex flex-col">
          <div className="flex h-12 items-center gap-2.5 border-b px-4">
            {searching ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <CommandPrimitive.Input
              value={query}
              onValueChange={setQuery}
              placeholder={canSearch ? 'جستجو کنید یا دستور بنویسید…' : 'دستور یا صفحه را بنویسید…'}
              className="h-full flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
            />
            <kbd className="rounded border bg-secondary px-1.5 font-mono text-[10px] text-muted-foreground">esc</kbd>
          </div>
          <CommandPrimitive.List className="max-h-[min(60vh,440px)] overflow-y-auto p-2">
            <CommandPrimitive.Empty className="py-10 text-center text-[13px] text-muted-foreground">
              {searching ? 'در حال جستجو…' : 'نتیجه‌ای پیدا نشد'}
            </CommandPrimitive.Empty>
            {groups.map((group) => (
              <CommandPrimitive.Group
                key={group.heading}
                heading={group.heading}
                className="pb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {group.items.map((item) => (
                  <CommandPrimitive.Item
                    key={item.id}
                    value={item.id}
                    onSelect={item.run}
                    className={cn(
                      'group flex h-10 cursor-pointer items-center gap-2.5 rounded-md px-2 text-[13.5px]',
                      'data-[selected=true]:bg-brand-soft data-[selected=true]:text-brand',
                    )}
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border bg-card text-muted-foreground group-data-[selected=true]:border-brand group-data-[selected=true]:bg-brand group-data-[selected=true]:text-white">
                      <item.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {item.label}
                      {item.sub && <span className="ms-2 text-[12px] text-muted-foreground">{item.sub}</span>}
                    </span>
                    {item.amount && (
                      <span className="shrink-0 font-mono text-[12px] text-muted-foreground">{item.amount}</span>
                    )}
                    {item.hint && (
                      <span dir="ltr" className="shrink-0 rounded border px-1.5 font-mono text-[10.5px] text-muted-foreground group-data-[selected=true]:border-brand group-data-[selected=true]:text-brand">
                        {item.hint}
                      </span>
                    )}
                  </CommandPrimitive.Item>
                ))}
              </CommandPrimitive.Group>
            ))}
          </CommandPrimitive.List>
          <div className="flex items-center gap-4 border-t bg-secondary px-4 py-2 text-[11px] text-muted-foreground">
            <span><kbd className="font-mono">↑↓</kbd> پیمایش</span>
            <span><kbd className="font-mono">⏎</kbd> اجرا</span>
            <span><kbd className="font-mono">esc</kbd> بستن</span>
            <span className="ms-auto">میانبر: G و یک حرف</span>
          </div>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  );
}
