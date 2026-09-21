import Link from 'next/link';
import { getAccounts, getInternalTransfers } from '@/actions/accounting';
import { TransferHistory } from '@/components/accounting/transfer-history';
import { Button } from '@/components/ui/button';
import { getCurrentRole, requireRouteAccess } from '@/lib/access';
import { ArrowLeftRight } from 'lucide-react';

export default async function TransfersPage() {
  await requireRouteAccess('/dashboard/accounting');
  const accounts = await getAccounts();
  const transfers = await getInternalTransfers();
  // Correcting a recorded transfer stays with the admin, like a recorded expense or exchange.
  const isAdmin = (await getCurrentRole()) === 'ADMIN';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">انتقال‌های وجه بین حساب‌ها</h1>
        <Button asChild>
          <Link href="/dashboard/accounting/transfers/new">
            <ArrowLeftRight className="h-4 w-4 ml-2" />
            انتقال جدید
          </Link>
        </Button>
      </div>
      <TransferHistory transfers={transfers} isAdmin={isAdmin} accounts={accounts} />
    </div>
  );
}
