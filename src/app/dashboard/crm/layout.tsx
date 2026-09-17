import { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/access';

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">مدیریت ارتباط با مشتری</h2>
      </div>
      {children}
    </div>
  );
}
