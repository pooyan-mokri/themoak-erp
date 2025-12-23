import { getShareholders, getShareholdersWithBalance } from '@/actions/shareholder';
import { getAccounts } from '@/actions/accounting';
import { ShareholderForm } from '@/components/accounting/shareholder-form';
import { ShareholderList } from '@/components/accounting/shareholder-list';
import { ShareholderDepositForm } from '@/components/accounting/shareholder-deposit-form';
import { ShareholderWithdrawalForm } from '@/components/accounting/shareholder-withdrawal-form';
import { ShareholderBalanceList } from '@/components/accounting/shareholder-balance-list';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { DollarSign } from 'lucide-react';

export default async function ShareholdersPage() {
  const shareholders = await getShareholders();
  const shareholdersWithBalance = await getShareholdersWithBalance();
  const accounts = await getAccounts();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">مدیریت صاحبان سهام</h1>
        <Link href="/dashboard/accounting/shareholders/profits">
          <Button>
            <DollarSign className="h-4 w-4 ml-2" />
            مدیریت سود قابل برداشت
          </Button>
        </Link>
      </div>
      
      <Tabs defaultValue="manage" className="space-y-4">
        <TabsList>
          <TabsTrigger value="manage">مدیریت صاحبان سهام</TabsTrigger>
          <TabsTrigger value="deposit">واریز سرمایه</TabsTrigger>
          <TabsTrigger value="withdraw">برداشت سرمایه</TabsTrigger>
          <TabsTrigger value="balance">موجودی و بدهی</TabsTrigger>
        </TabsList>

        <TabsContent value="manage" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <ShareholderForm />
            <ShareholderList shareholders={shareholders} />
          </div>
        </TabsContent>

        <TabsContent value="deposit" className="space-y-6">
          <div className="max-w-2xl">
            <ShareholderDepositForm shareholders={shareholders} accounts={accounts} />
          </div>
        </TabsContent>

        <TabsContent value="withdraw" className="space-y-6">
          <div className="max-w-2xl">
            <ShareholderWithdrawalForm shareholders={shareholders} accounts={accounts} />
          </div>
        </TabsContent>

        <TabsContent value="balance" className="space-y-6">
          <ShareholderBalanceList shareholders={shareholdersWithBalance} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

