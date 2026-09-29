import { Clock, PackageOpen, Truck, Wallet } from 'lucide-react';
import { KpiCard } from '@/components/dashboard/kpi-card';
import type { purchaseFigures } from './purchase-figures';

const fa = (n: number, digits = 0) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: digits }).format(n);

/** Open orders, in transit, what is owed to suppliers (finance.view) and the average lead time. */
export function PurchaseKpis({ figures }: { figures: ReturnType<typeof purchaseFigures> }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard
        label="سفارش‌های باز"
        icon={PackageOpen}
        value={fa(figures.open)}
        note={figures.payable !== undefined ? `ارزش ${fa(figures.openValue)} تومان` : 'دریافت‌نشده و لغونشده'}
      />
      <KpiCard
        label="در راه"
        icon={Truck}
        value={fa(figures.inTransit)}
        note={
          figures.awaitingReceipt > 0
            ? `در حال تولید یا حمل · ${fa(figures.awaitingReceipt)} رسیده و منتظر انبار`
            : 'در حال تولید یا حمل'
        }
      />
      {figures.payable !== undefined ? (
        <KpiCard
          label="مانده پرداخت به تأمین‌کنندگان"
          icon={Wallet}
          value={fa(figures.payable)}
          unit="تومان"
          note={figures.suppliersOwed > 0 ? `${fa(figures.suppliersOwed)} تامین‌کننده` : 'مانده‌ای نیست'}
        />
      ) : (
        <KpiCard label="مانده پرداخت به تأمین‌کنندگان" icon={Wallet} value="—" note="با دسترسی مالی دیده می‌شود" />
      )}
      <KpiCard
        label="میانگین زمان تامین"
        icon={Clock}
        value={figures.leadTimeDays === undefined ? '—' : fa(figures.leadTimeDays, 1)}
        unit={figures.leadTimeDays === undefined ? undefined : 'روز'}
        note={
          figures.leadTimeDays === undefined
            ? 'هنوز سفارشی کامل دریافت نشده'
            : `از ثبت تا دریافت · ${fa(figures.leadTimeOrders)} سفارش`
        }
      />
    </div>
  );
}
