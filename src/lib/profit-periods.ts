/**
 * The shareholders' profit, period by period: the company's net profit, what
 * the shares paid out of it, and what stays undistributed (shares below 100%).
 * A period calculated before the net profit was kept split all of it among the
 * shareholders, so its net profit is what they got. Pure, for the profits page.
 */
export type ProfitShare = {
  amount: number;
  periodStart: Date | string;
  periodEnd: Date | string;
  periodNetProfit?: number | null;
};

export type ProfitPeriod = {
  periodStart: Date | string;
  periodEnd: Date | string;
  netProfit: number;
  distributed: number;
  undistributed: number;
};

export function profitPeriods(shares: ProfitShare[]): ProfitPeriod[] {
  const periods = new Map<string, ProfitPeriod & { net: number | null }>();
  for (const share of shares) {
    const key = `${new Date(share.periodStart).toISOString()}|${new Date(share.periodEnd).toISOString()}`;
    const period = periods.get(key) ?? { periodStart: share.periodStart, periodEnd: share.periodEnd, netProfit: 0, distributed: 0, undistributed: 0, net: null };
    period.distributed += share.amount;
    if (share.periodNetProfit != null) period.net = share.periodNetProfit;
    periods.set(key, period);
  }
  return [...periods.values()]
    .map(({ net, ...period }) => {
      const netProfit = net ?? period.distributed;
      return { ...period, netProfit, undistributed: Math.max(0, netProfit - period.distributed) };
    })
    .sort((a, b) => new Date(b.periodStart).getTime() - new Date(a.periodStart).getTime());
}
