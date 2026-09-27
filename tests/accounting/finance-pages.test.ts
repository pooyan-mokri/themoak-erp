import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { prisma, resetDatabase } from '../helpers/db';
import { setTestRole } from '../stubs/auth';
import ExchangeRatesPage from '../../src/app/dashboard/accounting/exchange-rates/page';
import CurrencyExchangePage from '../../src/app/dashboard/accounting/currency-exchange/page';
import ShareholdersPage from '../../src/app/dashboard/accounting/shareholders/page';
import LoansPage from '../../src/app/dashboard/accounting/loans/page';
import EmployeeDebtsPage from '../../src/app/dashboard/accounting/employee-debts/page';
import ARAgingPage from '../../src/app/dashboard/accounting/ar-aging/page';
import FinancialReportsPage from '../../src/app/dashboard/reports/financial/page';
import { ExchangeRateManager } from '@/components/accounting/exchange-rate-list';
import { CurrencyExchangeForm } from '@/components/accounting/currency-exchange-form';
import { CurrencyExchangeHistory } from '@/components/accounting/currency-exchange-history';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { NewShareholderButton, ShareholderList } from '@/components/accounting/shareholder-list';
import { ShareholderDepositForm } from '@/components/accounting/shareholder-deposit-form';
import { LoanList } from '@/components/accounting/loan-list';
import { EmployeeDebtList } from '@/components/accounting/employee-debt-list';
import { ARAgingReport } from '@/components/accounting/ar-aging-report';
import { ProfitLossReport } from '@/components/reports/profit-loss-report';
import { openAccount } from './ledger';

// tsx compiles the page's JSX to React.createElement without importing React.
(globalThis as any).React = React;

beforeEach(async () => {
  setTestRole('ADMIN');
  await resetDatabase();
});
after(() => prisma.$disconnect());

/** Every element of `type` in a rendered tree. */
function all(node: any, type: unknown, found: any[] = []): any[] {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    for (const child of node) all(child, type, found);
    return found;
  }
  if (node.type === type) found.push(node.props);
  all(node.props?.children, type, found);
  all(node.props?.actions, type, found);
  return found;
}
const propsOf = (node: any, type: unknown) => all(node, type)[0];
const hrefs = (node: any, found: string[] = []): string[] => {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    for (const child of node) hrefs(child, found);
    return found;
  }
  if (typeof node.props?.href === 'string') found.push(node.props.href);
  hrefs(node.props?.children, found);
  hrefs(node.props?.actions, found);
  return found;
};

test('exchange rates: the rate history reaches the page; only finance.manage gets the form', async () => {
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 100_000, date: new Date('2026-01-01') } });
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 110_000, date: new Date('2026-01-09') } });

  let props = propsOf(await ExchangeRatesPage(), ExchangeRateManager);
  assert.equal(props.canManage, true);
  assert.deepEqual(props.rates.map((r: any) => r.rateToToman), [110_000, 100_000], 'the whole history, newest first');

  setTestRole('AUDITOR');
  props = propsOf(await ExchangeRatesPage(), ExchangeRateManager);
  assert.equal(props.canManage, false);
  assert.equal(props.rates.length, 2);
});

test('currency trade: holdings of each foreign account, the form for finance.manage, edits for the admin', async () => {
  await openAccount('novin', 50_000_000);
  await openAccount('usd', 1_500, 'USD');
  await prisma.exchangeRate.create({ data: { currency: 'USD', rateToToman: 100_000, date: new Date() } });

  let page = await CurrencyExchangePage();
  const holdings = all(page, KpiCard);
  assert.deepEqual(holdings.map((k) => k.unit), ['USD'], 'one card per foreign-currency account');
  assert.match(holdings[0].note, /۱۵۰٬۰۰۰٬۰۰۰ تومان/, 'valued at the latest rate');
  assert.ok(propsOf(page, CurrencyExchangeForm));
  assert.equal(propsOf(page, CurrencyExchangeHistory).isAdmin, true);

  setTestRole('ACCOUNTANT');
  page = await CurrencyExchangePage();
  assert.ok(propsOf(page, CurrencyExchangeForm), 'an accountant records trades');
  assert.equal(propsOf(page, CurrencyExchangeHistory).isAdmin, false, 'correcting a trade stays admin-only');

  setTestRole('AUDITOR');
  page = await CurrencyExchangePage();
  assert.equal(propsOf(page, CurrencyExchangeForm), undefined, 'the auditor gets no trade form');
});

test('shareholders: managing needs finance.manage, and the profits link profit.view', async () => {
  await prisma.shareholder.create({ data: { name: 'Ali', percentage: 60 } });

  let page = await ShareholdersPage();
  assert.equal(propsOf(page, ShareholderList).canManage, true);
  assert.ok(propsOf(page, NewShareholderButton));
  assert.ok(propsOf(page, ShareholderDepositForm));
  assert.ok(hrefs(page).includes('/dashboard/accounting/shareholders/profits'));

  setTestRole('ACCOUNTANT');
  page = await ShareholdersPage();
  assert.equal(propsOf(page, ShareholderList).canManage, true);
  assert.ok(!hrefs(page).includes('/dashboard/accounting/shareholders/profits'), 'an accountant never sees profit');

  setTestRole('AUDITOR');
  page = await ShareholdersPage();
  assert.equal(propsOf(page, ShareholderList).canManage, false);
  assert.equal(propsOf(page, NewShareholderButton), undefined);
  assert.equal(propsOf(page, ShareholderDepositForm), undefined, 'the auditor gets no deposit form');
  assert.ok(hrefs(page).includes('/dashboard/accounting/shareholders/profits'));
});

test('loans and employee debts: payroll.manage acts; the net card reads what is left on the loans', async () => {
  await openAccount('novin', 50_000_000);
  const employee = await prisma.employee.create({ data: { name: 'Sara', salary: 1 } });
  await prisma.loan.create({ data: { employeeId: employee.id, amount: 5_000_000, remaining: 3_000_000 } });
  await prisma.loan.create({ data: { employeeId: employee.id, amount: 1_000_000, remaining: 0, status: 'PAID' } });
  await prisma.transaction.create({
    data: { type: 'EXPENSE', amount: 700_000, amountInToman: 700_000, currency: 'TOMAN', employeeId: employee.id, category: 'اداری' },
  });

  assert.equal(propsOf(await LoansPage(), LoanList).canManage, true);
  let debts = propsOf(await EmployeeDebtsPage(), EmployeeDebtList);
  assert.equal(debts.canManage, true);
  assert.deepEqual(debts.loans, { outstanding: 3_000_000, count: 1 });
  assert.equal(debts.debts[0].totalDebt, 700_000);

  setTestRole('AUDITOR');
  assert.equal(propsOf(await LoansPage(), LoanList).canManage, false);
  debts = propsOf(await EmployeeDebtsPage(), EmployeeDebtList);
  assert.equal(debts.canManage, false);
});

test('receivables and profit and loss serve their data', async () => {
  const customer = await prisma.customer.create({ data: { name: 'Shop' } });
  await prisma.order.create({
    data: { customerId: customer.id, totalAmount: 2_000_000, paidAmount: 500_000, paymentStatus: 'PARTIAL', status: 'COMPLETED' },
  });
  const [row] = propsOf(await ARAgingPage(), ARAgingReport).data;
  assert.equal(row.totalDue, 1_500_000);

  await openAccount('novin', 0);
  await prisma.transaction.create({
    data: { type: 'INCOME', amount: 900_000, amountInToman: 900_000, currency: 'TOMAN', accountId: 'novin', category: 'Sales' },
  });
  setTestRole('AUDITOR');
  const report = propsOf(await FinancialReportsPage({ searchParams: {} }), ProfitLossReport);
  assert.equal(report.data.summary.income, 900_000, 'this month');
  assert.equal(report.previous.summary.income, 0, 'the month before');
  assert.equal(report.trend.length, 12);
  assert.equal(report.trend[11].income, 900_000, 'the chart ends with this month');
});
