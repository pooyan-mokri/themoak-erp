import { requireRouteAccess } from '@/lib/access';

// Sends a role without access (see ROUTE_PERMISSIONS) to the no-access page, for every
// page below, client pages included. Next renders a page even when its layout
// redirects, so each server page also calls requireRouteAccess before loading data.
export default async function GuardLayout({ children }: { children: React.ReactNode }) {
  await requireRouteAccess('/dashboard/settings/site');
  return children;
}
