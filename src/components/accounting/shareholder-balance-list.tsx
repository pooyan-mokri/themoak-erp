'use client';

import { fa } from './finance-bits';

interface ShareholderWithBalance {
  id: string;
  name: string;
  percentage: number;
  balance: number; // Positive = company owes shareholder, Negative = shareholder owes company
}

interface ShareholderBalanceListProps {
  shareholders: ShareholderWithBalance[];
}

/** Where each shareholder stands on capital: deposits less withdrawals, in Toman. */
export function ShareholderBalanceList({ shareholders }: ShareholderBalanceListProps) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="px-4 pt-4 pb-3">
        <h3 className="text-sm font-medium">موجودی و بدهی سهامداران</h3>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          واریز سرمایه، شرکت را به سهامدار بدهکار می‌کند (حساب پرداختنی) و برداشت، سهامدار را به شرکت (حساب دریافتنی).
        </p>
      </div>
      {shareholders.length === 0 ? (
        <p className="border-t px-4 py-8 text-center text-[13px] text-muted-foreground">هنوز سهامداری تعریف نشده است.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-y">
                <th className="h-9 bg-secondary px-4 text-start text-xs font-normal text-muted-foreground">سهامدار</th>
                <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">سهم</th>
                <th className="h-9 bg-secondary px-3 text-end text-xs font-normal text-muted-foreground">مانده (تومان)</th>
                <th className="h-9 bg-secondary px-4 text-start text-xs font-normal text-muted-foreground">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {shareholders.map((shareholder) => (
                <tr key={shareholder.id} className="h-11 border-b transition-colors duration-150 last:border-0 hover:bg-brand/[.04]">
                  <td className="px-4 font-medium">{shareholder.name}</td>
                  <td className="px-3 text-end tabular-nums text-muted-foreground">{fa(shareholder.percentage, 2)}٪</td>
                  <td className="px-3 text-end font-medium tabular-nums">{fa(Math.abs(shareholder.balance))}</td>
                  <td className="px-4">
                    {shareholder.balance > 0 ? (
                      <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11.5px] text-brand">شرکت بدهکار است</span>
                    ) : shareholder.balance < 0 ? (
                      <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11.5px] text-warning">سهامدار بدهکار است</span>
                    ) : (
                      <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11.5px] text-success">بدون بدهی</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
