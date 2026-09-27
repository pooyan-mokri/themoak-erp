import { getCustomerById } from '@/actions/customer';
import { Customer360 } from '@/components/crm/customer-360';
import { CustomerDebtCard } from '@/components/crm/customer-debt-card';
import { CustomerOrdersList } from '@/components/crm/customer-orders-list';
import { CustomerLeadsTab } from '@/components/crm/customer-leads-tab';
import { CustomerDealsTab } from '@/components/crm/customer-deals-tab';
import { CustomerTicketsTab } from '@/components/crm/customer-tickets-tab';
import { PageHeader } from '@/components/layout/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BackButton } from '@/components/ui/back-button';
import { notFound } from 'next/navigation';
import { hasPermission, requireRouteAccess } from '@/lib/access';

const fa = (n: number) => n.toLocaleString('fa-IR');

export default async function CustomerDetailsPage({ params }: { params: { id: string } }) {
  await requireRouteAccess('/dashboard/crm');
  const [customer, canManage] = await Promise.all([getCustomerById(params.id), hasPermission('sales.manage')]);

  if (!customer) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <BackButton href="/dashboard/crm/customers" label="بازگشت به لیست مشتریان" />
      <PageHeader title={customer.name} description="پروندهٔ مشتری: سفارش‌ها، سرنخ‌ها، فرصت‌ها و تیکت‌ها" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Profile & debt */}
        <div className="space-y-4">
          <Customer360 customer={customer} canManage={canManage} />
          <CustomerDebtCard
            creditLimit={Number(customer.creditLimit)}
            totalDebt={customer.stats.totalDebt}
            paymentTerms={customer.paymentTerms}
          />
        </div>

        {/* Orders, leads, deals, tickets */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="orders" className="w-full">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="orders">سفارش‌ها ({fa(customer.orders?.length || 0)})</TabsTrigger>
              <TabsTrigger value="leads">سرنخ‌ها ({fa(customer.leads?.length || 0)})</TabsTrigger>
              <TabsTrigger value="deals">فرصت‌ها ({fa(customer.deals?.length || 0)})</TabsTrigger>
              <TabsTrigger value="tickets">تیکت‌ها ({fa(customer.tickets?.length || 0)})</TabsTrigger>
            </TabsList>

            <TabsContent value="orders" className="mt-4">
              <CustomerOrdersList orders={customer.orders || []} />
            </TabsContent>

            <TabsContent value="leads" className="mt-4">
              <CustomerLeadsTab leads={customer.leads || []} />
            </TabsContent>

            <TabsContent value="deals" className="mt-4">
              <CustomerDealsTab deals={customer.deals || []} />
            </TabsContent>

            <TabsContent value="tickets" className="mt-4">
              <CustomerTicketsTab tickets={customer.tickets || []} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
