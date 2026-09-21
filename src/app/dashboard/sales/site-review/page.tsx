import { getSitePaymentsToReview } from '@/actions/site-review';
import { getAccountOptions } from '@/actions/account-options';
import { SiteReviewList } from '@/components/sales/site-review-list';
import { BackButton } from '@/components/ui/back-button';
import { getCurrentRole, requireRouteAccess } from '@/lib/access';

/**
 * Website orders whose money waits for a decision: cancelled on the site with
 * the money still booked, or paid by a test or untraced payment.
 */
export default async function SiteReviewPage() {
  await requireRouteAccess('/dashboard/sales');
  const isAdmin = (await getCurrentRole()) === 'ADMIN';
  const [rows, accounts] = await Promise.all([getSitePaymentsToReview(), isAdmin ? getAccountOptions() : []]);

  return (
    <div className="space-y-6">
      <BackButton href="/dashboard/sales" label="بازگشت به فروش" />
      <div>
        <h1 className="text-3xl font-bold tracking-tight">بررسی پول سفارش‌های سایت</h1>
        <p className="text-muted-foreground mt-2">
          سفارش‌هایی که در سایت لغو شده‌اند ولی پولشان هنوز در حساب است، و پرداخت‌هایی که آزمایشی‌اند یا ردّی از درگاه
          ندارند. هر سفارش تا وقتی مدیر تصمیمش را ثبت کند اینجا می‌ماند.
        </p>
      </div>
      <SiteReviewList rows={rows} accounts={accounts} isAdmin={isAdmin} />
    </div>
  );
}
