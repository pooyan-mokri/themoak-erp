import { getCurrentRole } from '@/lib/access';
import { WorldClient } from '@/components/world/world-client';

export const metadata = { title: 'دنیای کسب‌وکار' };

/**
 * The whole business as a small isometric world to walk around: warehouses,
 * partners' stores, the website, suppliers, customers, the treasury and the
 * last days' activity, always current (src/lib/world-data.ts). Every signed-in
 * user opens it and sees only what their role may.
 */
export default async function WorldPage() {
  return <WorldClient role={await getCurrentRole()} />;
}
