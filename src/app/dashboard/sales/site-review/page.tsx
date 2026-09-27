import { getSitePaymentsToReview } from '@/actions/site-review';
import { getAccountOptions } from '@/actions/account-options';
import { SiteReviewList } from '@/components/sales/site-review-list';
import { BackButton } from '@/components/ui/back-button';
import { PageHeader } from '@/components/layout/page-header';
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
    <div className="space-y-4">
      <BackButton href="/dashboard/sales" label="بازگشت به فروش" />
      <PageHeader
        title="بررسی پول سفارش‌های سایت"
        description={
          <>
            {rows.length > 0 && `${rows.length.toLocaleString('fa-IR')} سفارش منتظر تصمیم · `}
            سفارش‌هایی که در سایت لغو شده‌اند ولی پولشان هنوز در حساب است، و پرداخت‌هایی که آزمایشی‌اند یا ردّی از درگاه
            ندارند. هر سفارش تا وقتی مدیر تصمیمش را ثبت کند اینجا می‌ماند.
          </>
        }
      />
      <SiteReviewList rows={rows} accounts={accounts} isAdmin={isAdmin} />
    </div>
  );
}
