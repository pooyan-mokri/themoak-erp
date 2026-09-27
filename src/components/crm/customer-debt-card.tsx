import { cn } from '@/lib/utils';
import { PILL, fa } from './crm-labels';

interface CustomerDebtCardProps {
  creditLimit: number;
  totalDebt: number;
  paymentTerms: number;
}

/** Current debt against the credit limit, and the payment terms. */
export function CustomerDebtCard({ creditLimit, totalDebt, paymentTerms }: CustomerDebtCardProps) {
  const creditUsage = creditLimit > 0 ? (totalDebt / creditLimit) * 100 : 0;
  const isOverLimit = totalDebt > creditLimit && creditLimit > 0;

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-medium">وضعیت اعتبار و بدهی</h3>

      <div className="mt-3 flex items-baseline justify-between gap-2">
        <p className="text-[19px] font-medium tabular-nums">
          {fa(totalDebt)}
          <small className="ms-1 text-[11px] font-normal text-muted-foreground">تومان</small>
        </p>
        {isOverLimit && <span className={cn(PILL, 'bg-danger-soft text-danger')}>بیش از حد اعتبار</span>}
      </div>
      <p className="text-xs text-muted-foreground">کل بدهی جاری</p>

      {creditLimit > 0 && (
        <div className="mt-4 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">استفاده از اعتبار</span>
            <span className="tabular-nums">{fa(creditUsage)}٪</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn('h-full', isOverLimit ? 'bg-danger' : creditUsage >= 80 ? 'bg-warning' : 'bg-brand')}
              style={{ width: `${Math.min(100, creditUsage)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>۰</span>
            <span className="tabular-nums">سقف: {fa(creditLimit)}</span>
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-4 border-t pt-3">
        <div>
          <p className="text-xs text-muted-foreground">شرایط پرداخت</p>
          <p className="mt-0.5 text-[13.5px] font-medium">{fa(paymentTerms)} روزه</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">وضعیت حساب</p>
          <span className={cn(PILL, 'mt-1', totalDebt === 0 ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning')}>
            {totalDebt === 0 ? 'تسویه' : 'دارای بدهی'}
          </span>
        </div>
      </div>
    </div>
  );
}
