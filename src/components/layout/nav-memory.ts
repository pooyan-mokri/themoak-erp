'use client';

import { useCallback, useEffect, useState } from 'react';
import { getBreadcrumbs } from '@/lib/breadcrumbs';

/**
 * Pinned and recent pages, kept in this browser under the signed-in user's id
 * (a shared shop computer must not show one user's pages to the next). Every
 * component that shows them listens for one event, so a pin made in the header
 * shows in the sidebar at once.
 */
export type NavEntry = { href: string; label: string };

const PINS = 'erp.nav.pins.';
const RECENT = 'erp.nav.recent.';
const CHANGED = 'erp-nav-memory';
export const MAX_PINS = 5;
const MAX_RECENT = 6;

function read(key: string): NavEntry[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((e) => typeof e?.href === 'string' && typeof e?.label === 'string') : [];
  } catch {
    return [];
  }
}

function write(key: string, entries: NavEntry[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(entries));
  } catch {
    // Storage off (private window): pins just don't persist.
  }
  window.dispatchEvent(new Event(CHANGED));
}

/**
 * The page as a menu entry: its last breadcrumb. Null for a record's own page
 * (an order, a customer): the breadcrumbs skip the id, so it has no name here.
 */
export function entryFor(pathname: string): NavEntry | null {
  if (pathname === '/dashboard') return { href: pathname, label: 'داشبورد' };
  const last = getBreadcrumbs(pathname).at(-1);
  return last && last.href === pathname ? { href: pathname, label: last.label } : null;
}

export function useNavMemory(userId: string | undefined) {
  const [pins, setPins] = useState<NavEntry[]>([]);
  const [recent, setRecent] = useState<NavEntry[]>([]);

  useEffect(() => {
    const load = () => {
      setPins(userId ? read(PINS + userId) : []);
      setRecent(userId ? read(RECENT + userId) : []);
    };
    load();
    window.addEventListener(CHANGED, load);
    window.addEventListener('storage', load);
    return () => {
      window.removeEventListener(CHANGED, load);
      window.removeEventListener('storage', load);
    };
  }, [userId]);

  const togglePin = useCallback(
    (entry: NavEntry) => {
      if (!userId) return;
      const current = read(PINS + userId);
      const next = current.some((e) => e.href === entry.href)
        ? current.filter((e) => e.href !== entry.href)
        : [...current, entry].slice(-MAX_PINS);
      write(PINS + userId, next);
    },
    [userId],
  );

  const visit = useCallback(
    (entry: NavEntry) => {
      if (!userId) return;
      const next = [entry, ...read(RECENT + userId).filter((e) => e.href !== entry.href)].slice(0, MAX_RECENT);
      write(RECENT + userId, next);
    },
    [userId],
  );

  return { pins, recent, togglePin, visit };
}

/** Other parts of the shell open the palette or the drawer through these events. */
export const OPEN_PALETTE = 'erp-open-palette';
export const OPEN_MENU = 'erp-open-menu';
