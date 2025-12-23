import { getCustomer } from '@/actions/customer';
import { CustomerNotes } from '@/components/sales/customer-notes';
import { OrderList } from '@/components/sales/order-list';
import { notFound } from 'next/navigation';

export default async function CustomerDetailsPage({ params }: { params: { id: string } }) {
  const customer = await getCustomer(params.id);

  if (!customer) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">{customer.name}</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1 space-y-6">
            <div className="bg-card text-card-foreground rounded-xl border shadow p-6">
                <h3 className="font-semibold leading-none tracking-tight mb-4">اطلاعات تماس</h3>
                <div className="space-y-2 text-sm">
                    <div><span className="text-muted-foreground">تلفن:</span> {customer.phone || '-'}</div>
                    <div><span className="text-muted-foreground">ایمیل:</span> {customer.email || '-'}</div>
                    <div><span className="text-muted-foreground">آدرس:</span> {customer.address || '-'}</div>
                </div>
            </div>
            <CustomerNotes customerId={customer.id} initialNotes={customer.notes} />
        </div>
        
        <div className="md:col-span-2">
            <h2 className="text-xl font-semibold mb-4">تاریخچه سفارشات</h2>
            <OrderList orders={customer.orders} />
        </div>
      </div>
    </div>
  );
}
