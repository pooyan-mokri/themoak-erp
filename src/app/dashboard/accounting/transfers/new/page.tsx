import Link from 'next/link';
import { History } from 'lucide-react';
import { getAccounts, getInternalTransfers } from '@/actions/accounting';
import { TransferForm } from '@/components/accounting/transfer-form';
import { recentTransfers } from '@/components/accounting/recent-entries';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { requireRouteAccess } from '@/lib/access';

export default async function NewTransferPage() {
  await requireRouteAccess('/dashboard/accounting');
  const [accounts, transfers] = await Promise.all([getAccounts(), getInternalTransfers()]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="انتقال داخلی"
        description="جابجایی پول بین حساب‌های خود شرکت، فقط بین حساب‌هایی با ارز یکسان؛ در سود و زیان اثری ندارد."
        actions={
          <Button variant="outline" asChild>
            <Link href="/dashboard/accounting/transfers">
              <History className="h-4 w-4" />
              انتقال‌های ثبت‌شده
            </Link>
          </Button>
        }
      />
      <TransferForm accounts={accounts} recent={recentTransfers(transfers)} />
    </div>
  );
}
