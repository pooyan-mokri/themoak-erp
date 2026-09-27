'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { canAccessRoute } from '@/lib/permissions';
import { entryFor, useNavMemory } from '@/components/layout/nav-memory';
import { G_SHORTCUTS } from '@/components/layout/shortcuts';

/** Remembers each page visited (for «اخیر») and answers the G-letter jumps. */
export function NavKeys() {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const { visit } = useNavMemory(session?.user?.id);

  useEffect(() => {
    const entry = entryFor(pathname);
    if (entry && canAccessRoute(role, pathname)) visit(entry);
  }, [pathname, role, visit]);

  useEffect(() => {
    let armed = 0;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      // The physical key, so the jumps also work with the Persian layout (where G types «گ»).
      const key = event.code.startsWith('Key') ? event.code.slice(3).toLowerCase() : '';
      if (armed && Date.now() - armed < 1000 && G_SHORTCUTS[key]) {
        armed = 0;
        event.preventDefault();
        if (canAccessRoute(role, G_SHORTCUTS[key])) router.push(G_SHORTCUTS[key]);
        return;
      }
      armed = key === 'g' ? Date.now() : 0;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [role, router]);

  return null;
}
