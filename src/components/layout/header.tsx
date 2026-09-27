'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Menu, Search, Star } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserNav } from '@/components/layout/user-nav';
import { MobileMenu } from '@/components/layout/mobile-menu';
import { DashboardBreadcrumb } from '@/components/layout/dashboard-breadcrumb';
import { Button } from '@/components/ui/button';
import { OPEN_MENU, OPEN_PALETTE, entryFor, useNavMemory } from '@/components/layout/nav-memory';
import { cn } from '@/lib/utils';

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { data: session } = useSession();
  const pathname = usePathname() ?? '';
  const { pins, togglePin } = useNavMemory(session?.user?.id);
  const page = entryFor(pathname);
  const pinned = !!page && pins.some((pin) => pin.href === page.href);

  // The phone tab bar's «منو» opens the drawer.
  useEffect(() => {
    const onOpen = () => setMobileMenuOpen(true);
    window.addEventListener(OPEN_MENU, onOpen);
    return () => window.removeEventListener(OPEN_MENU, onOpen);
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

        {page && (
          <button
            type="button"
            onClick={() => togglePin(page)}
            title={pinned ? 'برداشتن سنجاق' : 'سنجاق به منو'}
            className={cn(
              'hidden h-8 w-8 place-items-center rounded-md transition-colors duration-150 hover:bg-secondary sm:grid',
              pinned ? 'text-warning' : 'text-muted-foreground',
            )}
          >
            <Star className="h-4 w-4" fill={pinned ? 'currentColor' : 'none'} strokeWidth={1.75} />
          </button>
        )}

        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE))}
          className="relative hidden h-9 w-72 items-center rounded-md border border-border bg-secondary pe-12 ps-9 text-start text-[13.5px] text-muted-foreground transition-colors duration-150 hover:border-brand/40 sm:flex"
        >
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          جستجو یا دستور…
          <kbd className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 rounded border bg-card px-1.5 font-mono text-[10px]">
            ⌘K
          </kbd>
        </button>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <UserNav />
        </div>
      </div>
      <MobileMenu open={mobileMenuOpen} onOpenChange={setMobileMenuOpen} />
    </>
  );
}
