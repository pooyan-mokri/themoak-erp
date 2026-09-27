import { requireRouteAccess } from '@/lib/access';
import { MarketingNav } from '@/components/marketing/marketing-nav';

// Sends a role without access (see ROUTE_PERMISSIONS) to the no-access page, for every
// page below, client pages included. Next renders a page even when its layout
// redirects, so each server page also calls requireRouteAccess before loading data.
export default async function GuardLayout({ children }: { children: React.ReactNode }) {
  await requireRouteAccess('/dashboard/marketing');
  return (
    <div className="space-y-4">
      <MarketingNav />
      {children}
    </div>
  );
}
