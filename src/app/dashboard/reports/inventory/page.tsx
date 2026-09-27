import { Boxes, Clock, Hourglass, Wallet } from 'lucide-react';
import { getStockTurnoverReport, getInventoryAgingReport } from '@/actions/reports';
import { PageHeader } from '@/components/layout/page-header';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { SectionCard } from '@/components/dashboard/section-card';
import { PrintButton } from '@/components/reports/print-button';
import { requireRouteAccess } from '@/lib/access';

const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Math.round(n));
const fa2 = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(n);

/** Older than 180 days is a danger, 90 to 180 a warning: the groups the aging report already uses. */
function ageGroup(days: number) {
  if (days > 180) return { label: 'بیش از ۱۸۰ روز', tone: 'bg-danger-soft text-danger' };
  if (days > 90) return { label: '۹۰ تا ۱۸۰ روز', tone: 'bg-warning-soft text-warning' };
  return { label: 'کمتر از ۹۰ روز', tone: 'bg-secondary text-muted-foreground' };
}

const TH = 'h-9 bg-secondary px-3 text-xs font-normal text-muted-foreground';

export default async function InventoryReportsPage() {
  await requireRouteAccess('/dashboard/reports/inventory');
  const [stockTurnover, inventoryAging] = await Promise.all([
    getStockTurnoverReport(),
    getInventoryAgingReport(),
  ]);

  const aged = inventoryAging.filter((item: any) => item.daysInStock > 90);
  const stocked = inventoryAging.filter((item: any) => item.quantity > 0);
  const stockValue = inventoryAging.reduce((sum: number, item: any) => sum + item.value, 0);
  const agedValue = aged.reduce((sum: number, item: any) => sum + item.value, 0);
  const veryOld = aged.filter((item: any) => item.daysInStock > 180);
  const turnover = stockTurnover.slice(0, 20);

  return (
    <div className="space-y-4">
      <PageHeader title="گزارش موجودی" description="گردش و قدمت موجودی کالا، به بهای تمام‌شده" actions={<PrintButton />} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="ارزش موجودی" icon={Wallet} value={fa(stockValue)} unit="تومان" note="همهٔ انبارها · تعداد × بهای تمام‌شده" />
        <KpiCard label="کالاهای موجود" icon={Boxes} value={fa(stocked.length)} note={`از ${fa(inventoryAging.length)} کالا`} />
        <KpiCard label="بیش از ۹۰ روز" icon={Hourglass} value={fa(aged.length)} note={`${fa(agedValue)} تومان`} />
        <KpiCard label="بیش از ۱۸۰ روز" icon={Clock} value={fa(veryOld.length)} note={`${fa(veryOld.reduce((s: number, i: any) => s + i.value, 0))} تومان`} />
      </div>

      <SectionCard title="نرخ گردش موجودی" count="۲۰ کالای پرگردش">
        <p className="-mt-1 mb-3 text-xs text-muted-foreground">
          فروش ۹۰ روز گذشته تقسیم بر موجودی فعلی؛ بیشتر از ۱ یعنی در این مدت بیش از موجودی فعلی فروخته شده است.
        </p>
        {turnover.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">هنوز فروش یا موجودی‌ای برای محاسبهٔ گردش ثبت نشده است.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-y">
                  <th className={`${TH} text-start`}>محصول</th>
                  <th className={`${TH} text-end`}>موجودی فعلی</th>
                  <th className={`${TH} text-end`}>فروش ۹۰ روز</th>
                  <th className={`${TH} text-end`}>نرخ گردش</th>
                </tr>
              </thead>
              <tbody>
                {turnover.map((product: any, index: number) => (
                  <tr key={index} className="h-11 border-b last:border-0 hover:bg-brand/[.04]">
                    <td className="max-w-[260px] truncate px-3 font-mono text-[12.5px]">
                      <bdi>{product.name}</bdi>
                    </td>
                    <td className="px-3 text-end tabular-nums">{fa(product.currentStock)}</td>
                    <td className="px-3 text-end tabular-nums">{fa(product.soldQuantity)}</td>
                    <td className="px-3 text-end">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11.5px] tabular-nums ${product.turnoverRate > 1 ? 'bg-brand-soft text-brand' : 'bg-secondary text-muted-foreground'}`}
                      >
                        {fa2(product.turnoverRate)}×
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="قدمت موجودی" count={`${fa(aged.length)} کالا بیش از ۹۰ روز`}>
        <p className="-mt-1 mb-3 text-xs text-muted-foreground">
          کالاهایی که مدت زیادی در انبار مانده‌اند. روز در انبار از تاریخ ثبت کالا حساب می‌شود، نه از تاریخ ورود آخرین
          موجودی.
        </p>
        {aged.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">هیچ کالایی بیش از ۹۰ روز در انبار نمانده است.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-y">
                  <th className={`${TH} text-start`}>محصول</th>
                  <th className={`${TH} text-start`}>SKU</th>
                  <th className={`${TH} text-end`}>تعداد</th>
                  <th className={`${TH} text-end`}>ارزش (تومان)</th>
                  <th className={`${TH} text-end`}>روز در انبار</th>
                  <th className={`${TH} text-start`}>گروه</th>
                </tr>
              </thead>
              <tbody>
                {aged.map((product: any, index: number) => {
                  const group = ageGroup(product.daysInStock);
                  return (
                    <tr key={index} className="h-11 border-b last:border-0 hover:bg-brand/[.04]">
                      <td className="max-w-[240px] truncate px-3 font-mono text-[12.5px]">
                        <bdi>{product.name}</bdi>
                      </td>
                      <td className="px-3 font-mono text-[12px] text-muted-foreground">{product.sku}</td>
                      <td className="px-3 text-end tabular-nums">{fa(product.quantity)}</td>
                      <td className="px-3 text-end font-medium tabular-nums">{fa(product.value)}</td>
                      <td className="px-3 text-end tabular-nums">{fa(product.daysInStock)}</td>
                      <td className="px-3">
                        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] ${group.tone}`}>{group.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
