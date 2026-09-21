/**
 * How an account is shown in a picker. Two accounts can have nearly the same
 * name («اقتصاد نوین» and «اقتصادنوین-دهقانی»), so the currency and the last
 * four digits of the card are shown too, when known.
 */
export function accountLabel(account: { name: string; currency?: string | null; cardNumber?: string | null }): string {
  const digits = (account.cardNumber ?? '').replace(/\D/g, '');
  const card = digits.length >= 4 ? ` •••• ${digits.slice(-4)}` : '';
  const currency = account.currency ? ` (${account.currency})` : '';
  return `${account.name}${currency}${card}`;
}
