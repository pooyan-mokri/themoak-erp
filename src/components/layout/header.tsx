'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserNav } from '@/components/layout/user-nav';
import { MobileMenu } from '@/components/layout/mobile-menu';
import { Button } from '@/components/ui/button';

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <>
      <div className="border-b">
        <div className="flex h-16 items-center px-4">
          {/* Mobile Menu Button */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden ml-2"
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu className="h-6 w-6" />
          </Button>
          
          <div className="mr-auto flex items-center space-x-4 space-x-reverse">
            <ThemeToggle />
            <UserNav />
          </div>
        </div>
      </div>
      <MobileMenu open={mobileMenuOpen} onOpenChange={setMobileMenuOpen} />
    </>
  );
}
