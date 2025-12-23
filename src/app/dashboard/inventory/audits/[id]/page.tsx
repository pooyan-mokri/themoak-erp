import { getInventoryAudit } from '@/actions/inventory-audit';
import { notFound } from 'next/navigation';
import { AuditDetailsTabs } from '@/components/inventory/audit-details-tabs';
import { BackButton } from '@/components/ui/back-button';

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

    return (
      <div className="space-y-6">
        <BackButton href="/dashboard/inventory/audits" label="بازگشت به لیست انبارگردانی‌ها" />
        <div>
          <h1 className="text-3xl font-bold">{audit.auditNumber}</h1>
          <p className="text-muted-foreground mt-1">
            انبار: {audit.warehouse.name}
          </p>
        </div>

        <AuditDetailsTabs audit={audit} />
      </div>
    );
  } catch (error) {
    console.error('Error loading audit:', error);
    notFound();
  }
}

