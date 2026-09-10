import { getAccountReconciliation } from '@/actions/accounting';
import { AccountReconciliation } from '@/components/accounting/account-reconciliation';
import { auth } from '@/auth';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight, Info } from 'lucide-react';

export default async function ReconciliationPage() {
  const rows = await getAccountReconciliation();
  const session = await auth();
  const isAdmin = session?.user?.role === 'ADMIN';

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
          موجودی ثبت‌شده هر حساب در برابر جمع تراکنش‌های خودش. حساب‌های هزینه‌ای (مثل بهای تمام‌شده) پول واقعی نیستند و اینجا نمایش داده نمی‌شوند.
        </p>
      </div>

      <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm dark:border-blue-900 dark:bg-blue-950/30">
        <Info className="h-5 w-5 shrink-0 text-blue-600" />
        <div className="space-y-1">
          <p>
            ستون «اختلاف» فقط خطا نیست: <strong>موجودی اولیه‌ی حساب</strong> هم در آن هست، چون هنگام ساخت
            حساب مستقیماً ثبت می‌شود و تراکنشی ندارد. پس اگر حسابی را با موجودی اولیه ساخته‌اید، وجود
            اختلاف طبیعی است.
          </p>
          <p className="text-muted-foreground">
            این صفحه حساب‌هایی را نشان می‌دهد که ارزش بررسی دارند. برای اصلاح، عدد واقعی حساب (مثلاً از
            صورتحساب بانک) را وارد کنید تا سند اصلاحی برای تفاوت ثبت شود و سابقه باقی بماند.
          </p>
        </div>
      </div>

      <AccountReconciliation rows={rows} isAdmin={isAdmin} />
    </div>
  );
}
