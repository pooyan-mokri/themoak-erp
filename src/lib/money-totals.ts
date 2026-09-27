import { Decimal } from '@prisma/client/runtime/library';

/**
 * Totals of account balances across currencies, for the dashboard and the
 * balance sheet.
 *
 * A balance is kept in its account's own currency, so a dollar balance of 1,000
 * is 1,000 dollars, not 1,000 Toman. The Toman total adds Toman accounts only.
 * Every other currency is totalled on its own and, when a rate is recorded,
 * valued at the latest recorded rate: an approximation, shown with that rate
 * and its date.
 */

export type RateRow = { currency: string; rateToToman: unknown; date: Date };

export type CurrencyTotal = {
  currency: string;
  /** The sum of the balances, in this currency. */
  total: number;
  /** Toman per 1 unit, the latest recorded; null when no rate was ever recorded. */
  rate: number | null;
  rateDate: Date | null;
  /** total × rate, approximate; null without a rate. */
  approxToman: number | null;
};

export type BalanceTotals = { toman: number; foreign: CurrencyTotal[] };

export function totalsByCurrency(
  accounts: Array<{ currency: string; balance: unknown }>,
  latestRates: RateRow[],
): BalanceTotals {
  const sums = new Map<string, Decimal>();
  for (const account of accounts) {
    const balance = new Decimal(account.balance as Decimal.Value);
    sums.set(account.currency, (sums.get(account.currency) ?? new Decimal(0)).plus(balance));
  }
  const foreign = [...sums.entries()]
    .filter(([currency]) => currency !== 'TOMAN')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, sum]) => {
      const latest = latestRates.find((rate) => rate.currency === currency);
      const rate = latest ? Number(latest.rateToToman) : null;
      return {
        currency,
        total: Number(sum),
        rate,
        rateDate: latest?.date ?? null,
        approxToman: rate === null ? null : Number(sum.times(rate)),
      };
    });
  return { toman: Number(sums.get('TOMAN') ?? 0), foreign };
}

/** The latest recorded rate of each currency (`client` is a Prisma client or transaction). */
export async function latestRates(client: any): Promise<RateRow[]> {
  return client.exchangeRate.findMany({
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    distinct: ['currency'],
    select: { currency: true, rateToToman: true, date: true },
  });
}
