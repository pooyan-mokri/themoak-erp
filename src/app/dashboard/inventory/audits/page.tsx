import { getInventoryAudits } from '@/actions/inventory-audit';
import { getWarehouses } from '@/actions/warehouse';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { Plus, Package, Calendar, Users } from 'lucide-react';
import { CreateAuditDialog } from '@/components/inventory/create-audit-dialog';

export default async function InventoryAuditsPage() {
  const audits = await getInventoryAudits();
  const warehouses = await getWarehouses();

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      PLANNED: 'outline',
      IN_PROGRESS: 'default',
      COMPLETED: 'secondary',
      CANCELLED: 'destructive',
    };

    const labels: Record<string, string> = {
      PLANNED: 'برنامه‌ریزی شده',
      IN_PROGRESS: 'در حال انجام',
      COMPLETED: 'تکمیل شده',
      CANCELLED: 'لغو شده',
    };

    return (
      <Badge variant={variants[status] || 'outline'}>
        {labels[status] || status}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">انبارگردانی</h1>
          <p className="text-muted-foreground mt-1">
            مدیریت و پیگیری عملیات انبارگردانی
          </p>
        </div>
        <CreateAuditDialog warehouses={warehouses} />
      </div>

      <div className="grid gap-4">
        {audits.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Package className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">هیچ انبارگردانی‌ای وجود ندارد</h3>
              <p className="text-muted-foreground text-center mb-4">
                برای شروع، یک انبارگردانی جدید ایجاد کنید.
              </p>
              <CreateAuditDialog warehouses={warehouses} />
            </CardContent>
          </Card>
        ) : (
          audits.map((audit: any) => (
            <Card key={audit.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2">
                      {audit.auditNumber}
                      {getStatusBadge(audit.status)}
                    </CardTitle>
                    <CardDescription>
                      انبار: {audit.warehouse.name}
                    </CardDescription>
                  </div>
                  <Link href={`/dashboard/inventory/audits/${audit.id}`}>
                    <Button variant="outline" size="sm">
                      مشاهده جزئیات
                    </Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">آیتم‌ها:</span>
                    <span className="font-medium">{audit._count.items}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">تیم:</span>
                    <span className="font-medium">{audit._count.teams}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">تاریخ ایجاد:</span>
                    <span className="font-medium">
                      {new Date(audit.createdAt).toLocaleDateString('fa-IR')}
                    </span>
                  </div>
                </div>
                {audit.description && (
                  <p className="text-sm text-muted-foreground mt-4">{audit.description}</p>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}



