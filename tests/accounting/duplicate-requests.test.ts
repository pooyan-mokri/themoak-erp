import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { prisma, resetDatabase, form } from '../helpers/db';
import { beforeQuery } from '../helpers/hooks';
import { setTestRole } from '../stubs/auth';
import { DUPLICATE_REQUEST_MESSAGE } from '@/lib/request-id';
import { recordDeposit, recordExpense, recordInternalTransfer, recordWithdrawal } from '@/actions/accounting';
import { exchangeCurrency } from '@/actions/currency-exchange';
import { balanceOf, driftOf, openAccount } from './ledger';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  beforeQuery.fn = null;
  await resetDatabase();
  await openAccount('novin', 10_000_000);
  await openAccount('dehghani', 5_000_000);
  await openAccount('usd', 100, 'USD');
});
after(() => prisma.$disconnect());

const REQUEST = 'lunch-0611-request-1';

/** The lunch of 1405/06/11: «Other - ناهار», 632,200, from اقتصاد نوین. */
const lunch = (requestId?: string, accountId = 'novin') =>
  form({
    amount: '632200',
    currency: 'TOMAN',
    category: 'Other',
    accountId,
    description: 'ناهار',
    date: '2026-09-02',
    ...(requestId ? { requestId } : {}),
  });

const rowsOf = (accountId: string) =>
  prisma.transaction.count({ where: { accountId, type: { not: 'ADJUSTMENT' } } });

test('the same expense submitted twice is booked once, and the repeat is answered as a success', async () => {
  const first = await recordExpense(undefined, lunch(REQUEST));
  assert.equal(first.success, true, first.message);
  const second = await recordExpense(undefined, lunch(REQUEST));
  assert.equal(second.success, true, second.message);
  assert.equal(second.message, DUPLICATE_REQUEST_MESSAGE);

  assert.equal(await rowsOf('novin'), 1);
  assert.equal(await balanceOf('novin'), 10_000_000 - 632_200);
  const row = await prisma.transaction.findFirstOrThrow({ where: { accountId: 'novin', type: 'EXPENSE' } });
  assert.equal(row.clientRequestId, REQUEST);
  assert.equal(await driftOf('novin'), 0);
});

test('a repeat is recognised even when the balance no longer covers a second copy', async () => {
  await prisma.account.update({ where: { id: 'novin' }, data: { balance: 700_000 } });
  await prisma.transaction.updateMany({ where: { accountId: 'novin' }, data: { amount: 700_000, amountInToman: 700_000 } });

  assert.equal((await recordExpense(undefined, lunch(REQUEST))).success, true);
  const repeat = await recordExpense(undefined, lunch(REQUEST));
  assert.equal(repeat.success, true, repeat.message);
  assert.equal(repeat.message, DUPLICATE_REQUEST_MESSAGE);
  assert.equal(await balanceOf('novin'), 700_000 - 632_200);
});

test('two copies arriving at the same moment book one expense', async () => {
  // The second copy arrives while the first is about to write: both pass the
  // first check, and whichever writes second is stopped by the unique id.
  let second = null as Promise<any> | null;
  beforeQuery.fn = async (params) => {
    if (params.model !== 'Transaction' || params.action !== 'create') return;
    beforeQuery.fn = null;
    second = recordExpense(undefined, lunch(REQUEST));
    await Promise.race([second, sleep(300)]);
  };
  const first = await recordExpense(undefined, lunch(REQUEST));
  beforeQuery.fn = null;
  assert.ok(second, 'the second copy was sent');
  const repeat = await second!;
  assert.equal(first.success, true, first.message);
  assert.equal(repeat.success, true, repeat.message);
  assert.deepEqual(
    [first.message, repeat.message].sort(),
    ['هزینه با موفقیت ثبت شد.', DUPLICATE_REQUEST_MESSAGE].sort(),
  );
  assert.equal(await rowsOf('novin'), 1);
  assert.equal(await balanceOf('novin'), 10_000_000 - 632_200);
});

test('a new id is a new entry, and a submission without an id is still booked', async () => {
  assert.equal((await recordExpense(undefined, lunch('lunch-request-a'))).success, true);
  assert.equal((await recordExpense(undefined, lunch('lunch-request-b'))).success, true);
  assert.equal((await recordExpense(undefined, lunch())).success, true);
  assert.equal(await rowsOf('novin'), 3);
});

test('an expense paid by an employee is protected the same way', async () => {
  const employee = await prisma.employee.create({ data: { name: 'Sara', salary: 1 } });
  const paid = () =>
    form({ amount: '500000', currency: 'TOMAN', category: 'Office', employeeId: employee.id, requestId: REQUEST });
  assert.equal((await recordExpense(undefined, paid())).success, true);
  assert.equal((await recordExpense(undefined, paid())).message, DUPLICATE_REQUEST_MESSAGE);
  assert.equal(await prisma.transaction.count({ where: { employeeId: employee.id } }), 1);
});

test('a deposit and a payment submitted twice are booked once each', async () => {
  const deposit = () =>
    form({ amount: '3000000', currency: 'TOMAN', accountId: 'novin', description: 'واریز مشتری', requestId: 'deposit-request-1' });
  assert.equal((await recordDeposit(undefined, deposit())).success, true);
  const again = await recordDeposit(undefined, deposit());
  assert.equal(again.success, true);
  assert.equal(again.message, DUPLICATE_REQUEST_MESSAGE);

  const payment = () =>
    form({ amount: '1000000', currency: 'TOMAN', accountId: 'novin', payee: 'تامین‌کننده', requestId: 'payment-request-1' });
  assert.equal((await recordWithdrawal(undefined, payment())).success, true);
  assert.equal((await recordWithdrawal(undefined, payment())).message, DUPLICATE_REQUEST_MESSAGE);

  assert.equal(await rowsOf('novin'), 2);
  assert.equal(await balanceOf('novin'), 10_000_000 + 3_000_000 - 1_000_000);
  assert.equal(await driftOf('novin'), 0);
});

test('a transfer submitted twice moves the money once; the id sits on its outgoing leg', async () => {
  const move = () =>
    form({ amount: '4000000', fromAccountId: 'novin', toAccountId: 'dehghani', requestId: 'transfer-request-1' });
  assert.equal((await recordInternalTransfer(undefined, move())).success, true);
  const again = await recordInternalTransfer(undefined, move());
  assert.equal(again.success, true);
  assert.equal(again.message, DUPLICATE_REQUEST_MESSAGE);

  assert.equal(await prisma.transaction.count({ where: { type: 'TRANSFER' } }), 2);
  assert.equal(await balanceOf('novin'), 6_000_000);
  assert.equal(await balanceOf('dehghani'), 9_000_000);
  const carrier = await prisma.transaction.findUniqueOrThrow({ where: { clientRequestId: 'transfer-request-1' } });
  assert.equal(carrier.accountId, 'novin');
  for (const id of ['novin', 'dehghani']) assert.equal(await driftOf(id), 0);
});

test('an exchange submitted twice is booked once', async () => {
  const buy = () =>
    form({
      sourceAccountId: 'novin',
      targetAccountId: 'usd',
      sourceAmount: '2350000',
      targetAmount: '10',
      sourceCurrency: 'TOMAN',
      targetCurrency: 'USD',
      exchangeRate: '235000',
      date: '2026-09-21',
      description: '',
      requestId: 'exchange-request-1',
    });
  const first = await exchangeCurrency(undefined, buy());
  assert.equal(first.success, true, first.message);
  const again = await exchangeCurrency(undefined, buy());
  assert.equal(again.success, true, again.message);
  assert.equal(again.message, DUPLICATE_REQUEST_MESSAGE);

  assert.equal(await prisma.transaction.count({ where: { category: 'Currency Exchange' } }), 2);
  assert.equal(await balanceOf('novin'), 10_000_000 - 2_350_000);
  assert.equal(await balanceOf('usd'), 110);
  const carrier = await prisma.transaction.findUniqueOrThrow({ where: { clientRequestId: 'exchange-request-1' } });
  assert.equal(carrier.accountId, 'novin', 'the id is on the first leg written');
});
