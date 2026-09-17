import { getUnrestoredCancelledOrders } from '@/actions/lost-stock';
import { LostStockList } from '@/components/inventory/lost-stock-list';
import { auth } from '@/auth';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight, AlertTriangle } from 'lucide-react';
import { requireRouteAccess } from '@/lib/access';

export default async function LostStockPage() {
  await requireRouteAccess('/dashboard/inventory');
  const orders = await getUnrestoredCancelledOrders();
  const session = await auth();
  const isAdmin = session?.user?.role === 'ADMIN';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/inventory">
          <Button variant="ghost" size="sm">
            <ArrowRight className="h-4 w-4 ml-2 rotate-180" />
            بازگشت به انبارداری
          </Button>
        </Link>
      </div>

      <div>
        <h1 className="text-3xl font-bold tracking-tight">موجودی بازنگشته</h1>
        <p className="text-muted-foreground mt-1">
          سفارش‌های لغوشده‌ای که کالاهایشان به انبار بازنگشته است.
        </p>
      </div>

      <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/30">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
        <div className="space-y-1">
          <p>
            در نسخه‌های قبلی، اگر روی قلم سفارش «انبار» ثبت نشده بود، هنگام لغو سفارش آن کالا بی‌صدا نادیده
            گرفته می‌شد و به موجودی بازنمی‌گشت. این ایراد برطرف شده و این صفحه موارد باقی‌مانده از گذشته را
            نشان می‌دهد.
          </p>
          <p className="text-muted-foreground">
            سفارش‌های ووکامرس در این فهرست نیستند، چون در آن‌ها اساساً از موجودی کسر نشده بود.
            پیش از ترمیم، موجودی فیزیکی انبار را بررسی کنید.
          </p>
        </div>
      </div>

      <LostStockList orders={orders} isAdmin={isAdmin} />
    </div>
  );
}
