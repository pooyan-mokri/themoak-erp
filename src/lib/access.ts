import * as React from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { canAny, ROUTE_PERMISSIONS, type Permission, type RoutePrefix } from '@/lib/permissions';

/**
 * Server-side permission checks against the signed-in user's role.
 *
 * Server-only (it reads the session), and deliberately NOT a 'use server' file:
 * these helpers are imported by actions and pages, never exposed as endpoints.
 * Every helper takes one permission or a list meaning "any of".
 */

export const ACCESS_DENIED_MESSAGE = 'شما به این بخش دسترسی ندارید.';
export const NO_ACCESS_PATH = '/dashboard/no-access';

export class AccessDenied extends Error {
  readonly permissions: readonly Permission[];

  constructor(permissions: readonly Permission[]) {
    super(ACCESS_DENIED_MESSAGE);
    this.name = 'AccessDenied';
    this.permissions = permissions;
  }
}

type Needed = Permission | readonly Permission[];

const anyOf = (needed: Needed): readonly Permission[] => (typeof needed === 'string' ? [needed] : needed);

// React.cache runs the session read (and its role lookup) once per server request.
// Outside a React server render (plain Node, the test runner) it is absent or a pass-through.
const cache: <T extends Function>(fn: T) => T = React.cache ?? ((fn) => fn);

const readSession = cache(() => auth());

/** The signed-in user's current role, or null for a stranger. */
export async function getCurrentRole(): Promise<string | null> {
  const session = await readSession();
  return session?.user?.role ?? null;
}

export async function hasPermission(needed: Needed): Promise<boolean> {
  return canAny(await getCurrentRole(), anyOf(needed));
}

/** Throws AccessDenied unless the user holds the permission. */
export async function requirePermission(needed: Needed): Promise<void> {
  if (!(await hasPermission(needed))) throw new AccessDenied(anyOf(needed));
}

export type AccessDeniedResult = { success: false; error: string; message: string };

/**
 * For actions that report failure in their result instead of throwing. Carries
 * the message as both `error` and `message`, since callers read either.
 *
 *   const denied = await checkPermission('finance.manage');
 *   if (denied) return denied;
 */
export async function checkPermission(needed: Needed): Promise<AccessDeniedResult | null> {
  if (await hasPermission(needed)) return null;
  return { success: false, error: ACCESS_DENIED_MESSAGE, message: ACCESS_DENIED_MESSAGE };
}

/** For server pages and layouts: sends the user to the no-access page. */
export async function requirePagePermission(needed: Needed): Promise<void> {
  if (!(await hasPermission(needed))) redirect(NO_ACCESS_PATH);
}

/** Guard for a segment layout, by its entry in ROUTE_PERMISSIONS. */
export async function requireRouteAccess(prefix: RoutePrefix): Promise<void> {
  await requirePagePermission(ROUTE_PERMISSIONS[prefix]);
}
