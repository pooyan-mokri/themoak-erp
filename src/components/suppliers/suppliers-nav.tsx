'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { href: '/dashboard/suppliers', label: 'نمای کلی' },
  { href: '/dashboard/suppliers/orders', label: 'سفارش‌های خرید' },
  { href: '/dashboard/suppliers/management', label: 'تامین‌کنندگان' },
];

/** The purchase section's tabs; the longest matching one is active. */
export function SuppliersNav() {
  const pathname = usePathname() ?? '';
  const active = SECTIONS.map((s) => s.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <nav className="-mt-1 flex gap-1 overflow-x-auto border-b">
      {SECTIONS.map((section) => (
        <Link
          key={section.href}
          href={section.href}
          className={cn(
            '-mb-px inline-flex h-9 shrink-0 items-center border-b-2 px-3 text-[13.5px] transition-colors duration-150',
            section.href === active
              ? 'border-brand font-medium text-brand'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}
