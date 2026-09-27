'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Menu, Search } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserNav } from '@/components/layout/user-nav';
import { MobileMenu } from '@/components/layout/mobile-menu';
import { DashboardBreadcrumb } from '@/components/layout/dashboard-breadcrumb';
import { Button } from '@/components/ui/button';
import { canAccessRoute } from '@/lib/permissions';

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { data: session } = useSession();
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const canSearch = canAccessRoute(session?.user?.role, '/dashboard/search');

  // ⌘K / Ctrl+K jumps to search from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <div className="flex h-14 items-center gap-3 border-b bg-card px-4 md:px-6">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileMenuOpen(true)} title="منو">
          <Menu className="h-5 w-5" />
        </Button>

        <div className="min-w-0 flex-1">
          <DashboardBreadcrumb />
        </div>

        {canSearch && (
          <form
            className="relative hidden w-72 sm:block"
            onSubmit={(event) => {
              event.preventDefault();
              const q = searchRef.current?.value.trim();
              router.push(q ? `/dashboard/search?q=${encodeURIComponent(q)}` : '/dashboard/search');
            }}
          >
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              type="search"
              placeholder="جستجو در سفارش‌ها، کالاها، مشتری‌ها…"
              className="h-9 w-full rounded-md border border-border bg-secondary pe-12 ps-9 text-[13.5px] outline-none transition-colors duration-150 placeholder:text-muted-foreground focus:border-brand focus:bg-card focus:ring-[3px] focus:ring-brand/[.12]"
            />
            <kbd className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 rounded border bg-card px-1.5 font-mono text-[10px] text-muted-foreground">
              ⌘K
            </kbd>
          </form>
        )}

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <UserNav />
        </div>
      </div>
      <MobileMenu open={mobileMenuOpen} onOpenChange={setMobileMenuOpen} />
    </>
  );
}
