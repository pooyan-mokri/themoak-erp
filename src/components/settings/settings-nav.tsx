'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpLeft, Bot, Building2, DatabaseBackup, Globe, UserRound, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { href: '/dashboard/settings', label: 'شرکت، انبار و FTP', icon: Building2, admin: true },
  { href: '/dashboard/settings/profile', label: 'پروفایل من', icon: UserRound, admin: false },
  { href: '/dashboard/settings/users', label: 'کاربران و نقش‌ها', icon: Users, admin: true },
  { href: '/dashboard/settings/backup', label: 'بک‌آپ', icon: DatabaseBackup, admin: true },
  { href: '/dashboard/settings/site', label: 'اتصال سایت', icon: Globe, admin: true },
  // The AI provider settings live on the assistant page, above its chat.
  { href: '/dashboard/assistant', label: 'دستیار هوش مصنوعی', icon: Bot, admin: true, away: true },
];

/** The settings sections this user may open: a list at the start, a scrolling row on a phone. */
export function SettingsNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname() ?? '';
  const visible = SECTIONS.filter((section) => isAdmin || !section.admin);
  const active = (href: string) =>
    href === '/dashboard/settings' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      aria-label="بخش‌های تنظیمات"
      className="flex gap-1 overflow-x-auto rounded-lg border bg-card p-1.5 lg:sticky lg:top-20 lg:flex-col lg:self-start print:hidden"
    >
      {visible.map((section) => (
        <Link
          key={section.href}
          href={section.href}
          aria-current={active(section.href) ? 'page' : undefined}
          className={cn(
            'flex h-9 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-3 text-[13px] transition-colors duration-150',
            active(section.href)
              ? 'bg-brand-soft font-medium text-brand'
              : 'text-foreground/80 hover:bg-secondary hover:text-foreground',
          )}
        >
          <section.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span className="flex-1">{section.label}</span>
          {section.away && <ArrowUpLeft className="h-3.5 w-3.5 text-muted-foreground" />}
        </Link>
      ))}
    </nav>
  );
}
