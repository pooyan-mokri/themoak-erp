import { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/access';
import { CrmNav } from '@/components/crm/crm-nav';

export const metadata: Metadata = {
  title: 'CRM Dashboard | TheMoak ERP',
  description: 'Customer Relationship Management Dashboard',
};

export default async function CRMLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireRouteAccess('/dashboard/crm');
  return (
    <div className="space-y-4">
      <CrmNav />
      {children}
    </div>
  );
}
