import { SupplierForm } from '@/components/suppliers/supplier-form';
import { requireRouteAccess } from '@/lib/access';
import { PageHeader } from '@/components/layout/page-header';

export default async function NewSupplierPage() {
  await requireRouteAccess('/dashboard/suppliers');
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="تامین‌کننده جدید" description="نام و راه تماس؛ بعد می‌توانید برایش سفارش خرید ثبت کنید" />
      <SupplierForm />
    </div>
  );
}
