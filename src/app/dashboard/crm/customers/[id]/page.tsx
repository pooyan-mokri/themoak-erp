import { getCustomerById } from '@/actions/customer';
import { Customer360 } from '@/components/crm/customer-360';
import { CustomerDebtCard } from '@/components/crm/customer-debt-card';
import { CustomerOrdersList } from '@/components/crm/customer-orders-list';
import { CustomerLeadsTab } from '@/components/crm/customer-leads-tab';
import { CustomerDealsTab } from '@/components/crm/customer-deals-tab';
import { CustomerTicketsTab } from '@/components/crm/customer-tickets-tab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BackButton } from '@/components/ui/back-button';
import { notFound } from 'next/navigation';

export default async function CustomerDetailsPage({ params }: { params: { id: string } }) {
  const customer = await getCustomerById(params.id);

  if (!customer) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <BackButton href="/dashboard/crm/customers" label="بازگشت به لیست مشتریان" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column: Profile & Debt */}
        <div className="space-y-6">
          <Customer360 customer={customer} />
          <CustomerDebtCard 
            creditLimit={Number(customer.creditLimit)} 
            totalDebt={customer.stats.totalDebt} 
            paymentTerms={customer.paymentTerms}
          />
        </div>

        {/* Right Column: Tabs (Orders, Leads, Deals, Tickets) */}
        <div className="md:col-span-2">
          <Tabs defaultValue="orders" className="w-full">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="orders">سفارش‌ها ({customer.orders?.length || 0})</TabsTrigger>
              <TabsTrigger value="leads">سرنخ‌ها ({customer.leads?.length || 0})</TabsTrigger>
              <TabsTrigger value="deals">فرصت‌ها ({customer.deals?.length || 0})</TabsTrigger>
              <TabsTrigger value="tickets">تیکت‌ها ({customer.tickets?.length || 0})</TabsTrigger>
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
