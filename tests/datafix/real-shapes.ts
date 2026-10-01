import { prisma } from '../helpers/db';
import { openAccount } from '../accounting/ledger';

// The rows Pooyan's 2026-10-01 decisions name, in the shape the real data has them (amounts, dates,
// descriptions, categories), for the data-fix tests. Accounts' balances follow their rows.

/** A row as the expense form books it: «<category> - <text>», its account's balance taken down. */
export async function expense(accountId: string, category: string, text: string, amount: number, date: string, currency = 'TOMAN') {
  const row = await prisma.transaction.create({
    data: {
      type: 'EXPENSE', currency: currency as any, amount, amountInToman: amount, accountId, category,
      description: `${category} - ${text}`, date: new Date(date),
    },
  });
  await prisma.account.update({ where: { id: accountId }, data: { balance: { decrement: amount } } });
  return row;
}

/** Money in, its account's balance raised. */
export async function income(accountId: string, category: string, description: string, amount: number, date: string) {
  const row = await prisma.transaction.create({
    data: { type: 'INCOME', amount, amountInToman: amount, accountId, category, description, date: new Date(date) },
  });
  await prisma.account.update({ where: { id: accountId }, data: { balance: { increment: amount } } });
  return row;
}

/** The six showroom deposit payments (three of them the partner's share) and the partner's repayment. */
export async function showroomDeposit(accountId: string) {
  const pay = (amount: number, date: string) => expense(accountId, 'Rent', 'بخشی از ودیعه showroom', amount, date);
  const lent = [await pay(500_000_000, '2026-07-19T20:30:00Z'), await pay(500_000_000, '2026-07-19T20:30:00Z'), await pay(34_000_000, '2026-07-27T20:30:00Z')];
  const own = [await pay(105_000_000, '2026-07-24T20:30:00Z'), await pay(200_000_000, '2026-07-24T20:30:00Z'), await pay(200_000_000, '2026-07-27T20:30:00Z')];
  const repaid = await income(accountId, 'واریز بانکی', 'دریافت مبلغ ودیعه مشاهیر', 1_034_000_000, '2026-08-09T11:28:31.700Z');
  return { lent, own, repaid };
}

/** The five «تنخواه» expenses: four for the showroom, one (BOOOM) a partner's withdrawal. */
export async function pettyCashAdvances(showroomAccount: string, otherAccount: string) {
  return {
    first: await expense(showroomAccount, 'Other', 'تنخواه اول SHOWROOM', 50_000_000, '2026-07-14T20:30:00Z'),
    second: await expense(otherAccount, 'Other', 'تنخواه دوم showroom', 50_000_000, '2026-07-22T20:30:00Z'),
    third: await expense(otherAccount, 'Other', 'تنخواه سوم showroom', 50_000_000, '2026-07-29T20:30:00Z'),
    fourth: await expense(otherAccount, 'Other', 'تنخواه چهارم مشاهیر', 20_000_000, '2026-08-11T11:22:21.267Z'),
    booom: await expense(otherAccount, 'Other', 'تنخواه BOOOM', 20_000_000, '2026-08-31T14:00:05.340Z'),
  };
}

/** The existing petty-cash account «تنخواه» (a BANK account on the real data), with its one earlier transfer. */
export async function pettyAccount(opening = 437_346) {
  await openAccount('petty', opening, 'TOMAN', { name: 'تنخواه' });
  return 'petty';
}

/** Order #121: 16,000,000 sold, one checkout row of 18,000,000 on a Toman bank account. */
export async function order121(accountId: string) {
  const checkout = await income(accountId, 'Sales', 'سفارش فروش', 18_000_000, '2026-02-28T00:00:00Z');
  const order = await prisma.order.create({
    data: {
      number: 121, totalAmount: 16_000_000, paidAmount: 18_000_000, paymentStatus: 'PAID', transactionId: checkout.id,
      createdAt: new Date('2026-02-28T00:00:00Z'),
    },
  });
  await prisma.transaction.update({ where: { id: checkout.id }, data: { orderId: order.id } });
  return { order, checkout };
}
