import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma, resetDatabase, form } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import { getEmployeeDebtDetails, payEmployeeDebt, updateAccount } from '@/actions/accounting';
import { exchangeCurrency, getCurrencyExchangeHistory, updateCurrencyExchange } from '@/actions/currency-exchange';
import { balanceOf, driftOf, openAccount } from './ledger';

// The actions log every refusal these tests provoke on purpose.
console.error = () => {};

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
  await openAccount('novin', 100_000_000);
  await openAccount('usd', 1_000, 'USD');
  await openAccount('eur', 0, 'EUR');
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 100_000, date: new Date() } });
  await prisma.exchangeRate.create({ data: { currency: 'EUR', rateToToman: 110_000, date: new Date() } });
});
after(() => prisma.$disconnect());

const balances = async () => ({ novin: await balanceOf('novin'), usd: await balanceOf('usd'), eur: await balanceOf('eur') });

// ─── payEmployeeDebt ──────────────────────────────────────────────────────────

test('repaying an employee from the dollar account moves the Toman debt divided by the rate', async () => {
  const employee = await prisma.employee.create({ data: { name: 'Sara', salary: 1 } });

  const paid = await payEmployeeDebt(undefined, form({ employeeId: employee.id, amount: '5000000', accountId: 'usd' }));
  assert.equal(paid.success, true, paid.message);
  assert.equal(await balanceOf('usd'), 950, '5,000,000 Toman at 100,000 is 50 dollars, not 5,000,000');

  const row = await prisma.transaction.findFirstOrThrow({ where: { employeeId: employee.id } });
  assert.equal(Number(row.amount), 50);
  assert.equal(row.currency, 'USD');
  assert.equal(Number(row.amountInToman), 5_000_000);
  assert.equal(Number(row.rateSnapshot), 100_000);
  assert.equal(await driftOf('usd'), 0);
  assert.equal((await getEmployeeDebtDetails(employee.id))!.totalPayments, 5_000_000, 'the debt is still netted in Toman');

  // More than the dollars cover is refused, in dollars, and changes nothing.
  const tooMuch = await payEmployeeDebt(undefined, form({ employeeId: employee.id, amount: '200000000', accountId: 'usd' }));
  assert.equal(tooMuch.success, false);
  assert.match(tooMuch.message!, /کافی نیست/);
  assert.equal(await balanceOf('usd'), 950);

  // A Toman account moves by the figure itself, as before.
  assert.equal((await payEmployeeDebt(undefined, form({ employeeId: employee.id, amount: '1000', accountId: 'novin' }))).success, true);
  assert.equal(await balanceOf('novin'), 100_000_000 - 1_000);
});

// ─── updateAccount ────────────────────────────────────────────────────────────

test('the currency of an account that has transactions cannot be changed; other edits still can', async () => {
  const relabel = await updateAccount('usd', undefined, form({ name: 'حساب ذخیره دلاری', type: 'BANK', currency: 'TOMAN' }));
  assert.equal(relabel.success, undefined);
  assert.match(relabel.message!, /ارز حسابی که تراکنش دارد قابل تغییر نیست/);
  assert.equal((await prisma.account.findUniqueOrThrow({ where: { id: 'usd' } })).currency, 'USD');

  const renamed = await updateAccount(
    'usd',
    undefined,
    form({ name: 'حساب ذخیره دلاری', type: 'BANK', currency: 'USD', cardNumber: '6037991234567890' }),
  );
  assert.equal(renamed.success, true, renamed.message);
  const stored = await prisma.account.findUniqueOrThrow({ where: { id: 'usd' } });
  assert.equal(stored.name, 'حساب ذخیره دلاری');
  assert.equal(stored.cardNumber, '6037991234567890');
  assert.equal(Number(stored.balance), 1_000);

  // An account with no history yet may still be switched.
  await openAccount('fresh', 0);
  const switched = await updateAccount('fresh', undefined, form({ name: 'تازه', type: 'BANK', currency: 'USD' }));
  assert.equal(switched.success, true, switched.message);
  assert.equal((await prisma.account.findUniqueOrThrow({ where: { id: 'fresh' } })).currency, 'USD');
});

// ─── exchange amounts against the rate ───────────────────────────────────────

const exchange = (fields: Record<string, string>) =>
  exchangeCurrency(undefined, form({ date: '2026-09-20', description: '', ...fields }));

test('an exchange whose amounts do not match the rate is refused and books nothing', async () => {
  // 20,000,000 Toman cannot buy 91 dollars at 90.91 Toman a dollar (that is 8,273 Toman).
  const miskeyed = await exchange({
    sourceAccountId: 'novin', targetAccountId: 'usd', sourceAmount: '20000000', targetAmount: '91',
    sourceCurrency: 'TOMAN', targetCurrency: 'USD', exchangeRate: '90.91',
  });
  assert.equal(miskeyed.success, false);
  assert.match(miskeyed.message, /با نرخ نمی‌خوانند/);
  assert.match(miskeyed.message, /تومان به ازای هر ۱ USD/);

  // Selling at half the real rate.
  const selling = await exchange({
    sourceAccountId: 'usd', targetAccountId: 'novin', sourceAmount: '50', targetAmount: '9000000',
    sourceCurrency: 'USD', targetCurrency: 'TOMAN', exchangeRate: '90000',
  });
  assert.equal(selling.success, false);
  assert.match(selling.message, /با نرخ نمی‌خوانند/);

  assert.deepEqual(await balances(), { novin: 100_000_000, usd: 1_000, eur: 0 });
  assert.equal(await prisma.transaction.count({ where: { category: 'Currency Exchange' } }), 0);
});

test('amounts within 1% of foreign × rate are accepted, and exchanges without a Toman side are not checked this way', async () => {
  // 91 × 219,780 = 19,999,980: rounding, not a mistake.
  const rounded = await exchange({
    sourceAccountId: 'novin', targetAccountId: 'usd', sourceAmount: '20000000', targetAmount: '91',
    sourceCurrency: 'TOMAN', targetCurrency: 'USD', exchangeRate: '219780',
  });
  assert.equal(rounded.success, true, rounded.message);

  const crossed = await exchange({
    sourceAccountId: 'usd', targetAccountId: 'eur', sourceAmount: '10', targetAmount: '9',
    sourceCurrency: 'USD', targetCurrency: 'EUR', exchangeRate: '0.9',
  });
  assert.equal(crossed.success, true, crossed.message);
  assert.deepEqual(await balances(), { novin: 80_000_000, usd: 1_081, eur: 9 });
});

test('an edit whose amounts do not match the rate is refused and leaves the exchange as it was', async () => {
  const bought = await exchange({
    sourceAccountId: 'novin', targetAccountId: 'usd', sourceAmount: '10000000', targetAmount: '100',
    sourceCurrency: 'TOMAN', targetCurrency: 'USD', exchangeRate: '100000',
  });
  assert.equal(bought.success, true, bought.message);
  const before = await balances();
  const [recorded] = await getCurrencyExchangeHistory();

  const refused = await updateCurrencyExchange({
    id: recorded.id,
    sourceAccountId: 'novin',
    targetAccountId: 'usd',
    sourceAmount: 10_000_000,
    targetAmount: 110,
    sourceCurrency: 'TOMAN' as any,
    targetCurrency: 'USD' as any,
    exchangeRate: 90.91,
  });
  assert.equal(refused.success, false);
  assert.match(refused.message, /با نرخ نمی‌خوانند/);
  assert.deepEqual(await balances(), before);
  assert.equal((await getCurrencyExchangeHistory())[0].targetAmount, 100);
});
