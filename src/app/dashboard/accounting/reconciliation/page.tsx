import { getAccountReconciliation } from '@/actions/accounting';
import { AccountReconciliation } from '@/components/accounting/account-reconciliation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight, Info } from 'lucide-react';
import { getCurrentRole, requireRouteAccess } from '@/lib/access';

export default async function ReconciliationPage() {
  await requireRouteAccess('/dashboard/accounting');
  const rows = await getAccountReconciliation();
  const isAdmin = (await getCurrentRole()) === 'ADMIN';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/accounting">
          <Button variant="ghost" size="sm">
            <ArrowRight className="h-4 w-4 ml-2 rotate-180" />
            بازگشت به حسابداری
          </Button>
        </Link>
      </div>

      <div>
        <h1 className="text-3xl font-bold tracking-tight">مغایرت‌گیری حساب‌ها</h1>
        <p className="text-muted-foreground mt-1">
          موجودی ثبت‌شده هر حساب در برابر جمع تراکنش‌های خودش و آخرین رقم بانک. حساب‌های هزینه‌ای (مثل بهای تمام‌شده) پول واقعی نیستند و اینجا نمایش داده نمی‌شوند.
        </p>
      </div>

      <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm dark:border-blue-900 dark:bg-blue-950/30">
        <Info className="h-5 w-5 shrink-0 text-blue-600" />
        <div className="space-y-1">
          <p>
            اختلاف قدیمی حساب‌ها (موجودی اولیه‌ای که بدون تراکنش ثبت شده، ویرایش‌های قدیمی موجودی) مال گذشته
            است. با <strong>«ثبت مانده پایه»</strong> یک بار برای هر حساب ثبت می‌شود و اختلاف صفر می‌شود؛
            موجودی حساب تغییر نمی‌کند. از آن به بعد هر اختلافی تازه است و باید بررسی شود.
          </p>
          <p className="text-muted-foreground">
            با «ثبت موجودی بانک» رقم صورتحساب را بدون هیچ تغییری نگه دارید. موجودی بانک اکنون باید برابر باشد با
            رقم آخرین بررسی به‌علاوه‌ی «ثبت‌شده در سیستم از آن زمان». برای اصلاح، رقم بانک را خودتان در «اصلاح
            موجودی» وارد کنید تا سند اصلاحی برای تفاوت ثبت شود و سابقه باقی بماند.
          </p>
        </div>
      </div>

      <AccountReconciliation rows={rows} isAdmin={isAdmin} />
    </div>
  );
}
