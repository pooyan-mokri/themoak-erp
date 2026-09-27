import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

export type QuickAction = { href: string; label: string; icon: LucideIcon };

/** The day's most frequent entries, one click away — only those the role may do. */
export function QuickActions({ actions }: { actions: QuickAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <Link
          key={action.href}
          href={action.href}
          className="inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-[13px] transition-colors duration-150 hover:border-brand hover:bg-brand/[.04]"
        >
          <action.icon className="h-4 w-4 text-brand" strokeWidth={1.75} />
          {action.label}
        </Link>
      ))}
    </div>
  );
}
