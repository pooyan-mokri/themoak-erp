'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { getSiteHookAlerts } from '@/actions/site-connection';

const REFRESH_MS = 60_000;

/**
 * The stock push alerts, for admins (the action answers nobody else). Read
 * again on every page change and every minute: the dashboard layout is not
 * rendered again when the admin moves between pages.
 */
export function SiteHookAlerts() {
  const pathname = usePathname();
  const [alerts, setAlerts] = useState<string[]>([]);

  useEffect(() => {
    let current = true;
    const load = () =>
      getSiteHookAlerts()
        .then((next) => {
          if (current) setAlerts(next);
        })
        .catch(() => undefined); // keeps what is shown until the next read
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [pathname]);

  if (alerts.length === 0) return null;

  return (
    <Link
      href="/dashboard/settings/site"
      className="mb-4 flex items-start gap-2 rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200 print:hidden"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-1">
        {alerts.map((alert) => (
          <p key={alert}>{alert}</p>
        ))}
        <p className="text-xs underline">تنظیمات › اتصال سایت</p>
      </div>
    </Link>
  );
}
