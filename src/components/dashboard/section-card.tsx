import Link from 'next/link';
import type { ReactNode } from 'react';

/** A dashboard card: 14/500 title, an optional count, and an optional link at the end. */
export function SectionCard({
  title,
  count,
  link,
  aside,
  children,
}: {
  title: string;
  count?: ReactNode;
  link?: { href: string; label: string };
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          {title}
          {count !== undefined && (
            <span className="rounded bg-secondary px-1.5 font-mono text-[11px] font-normal text-muted-foreground">{count}</span>
          )}
        </h3>
        <div className="flex items-center gap-3 text-xs">
          {aside}
          {link && (
            <Link href={link.href} className="text-brand hover:underline">
              {link.label}
            </Link>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
