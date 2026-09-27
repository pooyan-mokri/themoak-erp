'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { SidebarNav } from './sidebar-nav';

interface MobileMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The same navigation as the desktop sidebar, in a drawer. */
export function MobileMenu({ open, onOpenChange }: MobileMenuProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[260px] p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>منو</SheetTitle>
        </SheetHeader>
        <SidebarNav onNavigate={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}
