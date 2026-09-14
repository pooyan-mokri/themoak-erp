import { getInventoryAudit } from '@/actions/inventory-audit';
import { notFound } from 'next/navigation';
import { AuditDetailsTabs } from '@/components/inventory/audit-details-tabs';
import { BackButton } from '@/components/ui/back-button';
import { auth } from '@/auth';

// Issuing adjustments runs from this page: one transaction with a few writes per adjusted item.
export const maxDuration = 60;

export default async function InventoryAuditDetailsPage({
  params,
}: {
  params: { id: string };
}) {
  try {
    const audit = await getInventoryAudit(params.id);

    if (!audit) {
      notFound();
    }

    const session = await auth();
    const isAdmin = session?.user?.role === 'ADMIN';

    return (
      <div className="space-y-6">
        <BackButton href="/dashboard/inventory/audits" label="بازگشت به لیست انبارگردانی‌ها" />
        <div>
          <h1 className="text-3xl font-bold">{audit.auditNumber}</h1>
          <p className="text-muted-foreground mt-1">
            انبار: {audit.warehouse.name}
          </p>
        </div>

        <AuditDetailsTabs audit={audit} isAdmin={isAdmin} />
      </div>
    );
  } catch (error) {
    console.error('Error loading audit:', error);
    notFound();
  }
}

