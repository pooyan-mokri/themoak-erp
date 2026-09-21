import { randomUUID, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { inAccountCurrency } from '@/lib/balance-reconciliation';
import { consignmentAmounts } from '@/lib/return-math';
import { createSale, setSaleStatus } from '@/lib/site-sale';
import { kickSiteHook } from '@/lib/site-hook';
import { DUPLICATE_REQUEST_MESSAGE, isDuplicateRequest, readRequestId } from '@/lib/request-id';

// Website sales run one database transaction capped at 15 s (src/lib/site-sale.ts).
export const maxDuration = 30;

// ── Auth helper ──────────────────────────────────────────────────────────────
// Two keys (docs/erp-api.md):
//   ERP_API_SECRET      — the owner's full key (MCP tools): every action.
//   ERP_SITE_API_SECRET — the website's key: only the four actions below.
// They must differ. If both hold the same value the caller gets the full key.
const SITE_GET_ACTIONS = ['warehouses', 'stock'];
const SITE_POST_ACTIONS = ['createSale', 'setSaleStatus'];

type ApiKey = 'full' | 'site';

function bearerMatches(auth: string, secret: string | undefined): boolean {
  if (!secret) return false; // an unset or empty secret matches nothing
  const given = Buffer.from(auth);
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function authenticate(req: NextRequest): ApiKey | null {
  const auth = req.headers.get('authorization') ?? '';
  const full = bearerMatches(auth, process.env.ERP_API_SECRET);
  const site = bearerMatches(auth, process.env.ERP_SITE_API_SECRET);
  if (full) return 'full';
  return site ? 'site' : null;
}

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

function forbidden() {
  return NextResponse.json({ error: 'Forbidden for this key' }, { status: 403 });
}

// ── GET /api/erp?action=<action>&... ─────────────────────────────────────────
const GET_ACTIONS = [
  'summary',
  'accounts',
  'transactions',
  'orders',
  'settlements',
  'loans',
  'search',
  'warehouses',
  'stock',
];

// The site reads 404 as "the ERP does not have this action yet".
function unknownGetAction() {
  return NextResponse.json({ error: 'Unknown action', availableActions: GET_ACTIONS }, { status: 404 });
}

export async function GET(req: NextRequest) {
  const key = authenticate(req);
  if (!key) return unauthorized();

  const { searchParams } = req.nextUrl;
  const action = searchParams.get('action') ?? '';
  // The site key runs nothing outside its list: a real action is 403, any other still 404.
  if (key === 'site' && !SITE_GET_ACTIONS.includes(action))
    return GET_ACTIONS.includes(action) ? forbidden() : unknownGetAction();

  try {
    switch (action) {
      // ── خلاصه مالی ─────────────────────────────────────────────────────────
      case 'summary': {
        // EXPENSE-type accounts are P&L buckets, not money — see reporting.ts.
        const accounts = await prisma.account.findMany({ where: { type: { not: 'EXPENSE' } } });
        const totalToman = accounts.reduce(
          (s: number, a: any) => s + Number(a.balance),
          0,
        );
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        const income = await prisma.transaction.aggregate({
          where: { type: 'INCOME', date: { gte: lastMonth } },
          _sum: { amountInToman: true },
        });
        const expense = await prisma.transaction.aggregate({
          where: { type: 'EXPENSE', date: { gte: lastMonth } },
          _sum: { amountInToman: true },
        });
        const pendingOrders = await prisma.order.count({
          where: { paymentStatus: { in: ['UNPAID', 'PARTIAL'] }, status: { not: 'CANCELLED' } },
        });
        return NextResponse.json({
          totalBalanceToman: totalToman,
          accounts: await prisma.account.count(),
          last30Days: {
            income: Number(income._sum.amountInToman ?? 0),
            expense: Number(expense._sum.amountInToman ?? 0),
            profit: Number(income._sum.amountInToman ?? 0) - Number(expense._sum.amountInToman ?? 0),
          },
          pendingSettlements: pendingOrders,
        });
      }

      // ── لیست حساب‌ها ────────────────────────────────────────────────────────
      case 'accounts': {
        const accounts = await prisma.account.findMany({ orderBy: { name: 'asc' } });
        return NextResponse.json(
          accounts.map((a: any) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            currency: a.currency,
            balance: Number(a.balance),
            cardNumber: a.cardNumber ?? null,
            sheba: a.sheba ?? null,
          })),
        );
      }

      // ── تراکنش‌های اخیر ──────────────────────────────────────────────────────
      case 'transactions': {
        const limit = Math.min(Number(searchParams.get('limit') ?? 50), 200);
        const type = searchParams.get('type'); // INCOME | EXPENSE | TRANSFER
        const txs = await prisma.transaction.findMany({
          where: type ? { type } : undefined,
          include: { account: { select: { name: true } } },
          orderBy: { date: 'desc' },
          take: limit,
        });
        return NextResponse.json(
          txs.map((t: any) => ({
            id: t.id,
            date: t.date,
            type: t.type,
            amount: Number(t.amount),
            currency: t.currency,
            amountInToman: Number(t.amountInToman),
            description: t.description,
            category: t.category,
            account: t.account?.name ?? null,
            payee: t.payee ?? null,
            tags: t.tags ?? [],
          })),
        );
      }

      // ── سفارش‌های اخیر ──────────────────────────────────────────────────────
      case 'orders': {
        const limit = Math.min(Number(searchParams.get('limit') ?? 30), 100);
        const orders = await prisma.order.findMany({
          include: {
            customer: { select: { name: true } },
            items: { include: { product: { select: { name: true } } } },
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
        });
        return NextResponse.json(
          orders.map((o: any) => ({
            id: o.id,
            number: o.number,
            customer: o.customer?.name ?? null,
            status: o.status,
            paymentStatus: o.paymentStatus,
            totalAmount: Number(o.totalAmount),
            paidAmount: Number(o.paidAmount),
            createdAt: o.createdAt,
            items: o.items.map((i: any) => ({
              product: i.product?.name,
              quantity: i.quantity,
              price: Number(i.price),
            })),
          })),
        );
      }

      // ── تسویه‌های در انتظار (امانت) ──────────────────────────────────────────
      case 'settlements': {
        const orders = await prisma.order.findMany({
          where: {
            paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
            status: { not: 'CANCELLED' },
            customer: { warehouses: { some: { isVirtual: true } } },
            siteReference: null, // website orders are settled on the website, never with a partner
          },
          include: {
            customer: { select: { name: true } },
            // Returned and exchanged units are neither owed nor charged commission.
            items: { include: { returns: { select: { quantity: true } }, exchanges: { select: { quantity: true } } } },
            commissions: true,
          },
          orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(
          orders.map((o: any) => {
            // The same arithmetic as the settlement page (src/actions/consignment.ts).
            const amounts = consignmentAmounts(o);
            return {
              id: o.id,
              number: o.number,
              partner: o.customer?.name ?? null,
              grossAmount: amounts.grossAmount,
              commissionAmount: amounts.commissionAmount,
              netAmount: amounts.netAmount,
              paidAmount: amounts.paidAmount,
              remainingAmount: amounts.remainingAmount,
              createdAt: o.createdAt,
            };
          }),
        );
      }

      // ── قرض‌های کارمندان ─────────────────────────────────────────────────────
      case 'loans': {
        const loans = await prisma.loan.findMany({
          include: { employee: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(
          loans.map((l: any) => ({
            id: l.id,
            employee: l.employee?.name,
            amount: Number(l.amount),
            remaining: Number(l.remaining),
            paid: Number(l.amount) - Number(l.remaining),
            status: l.status,
            dueDate: l.dueDate,
          })),
        );
      }

      // ── جستجوی کلی ──────────────────────────────────────────────────────────
      case 'search': {
        const q = searchParams.get('q') ?? '';
        if (q.length < 2)
          return NextResponse.json({ error: 'Query too short' }, { status: 400 });

        const [customers, products, txs, orders] = await Promise.all([
          prisma.customer.findMany({
            where: { name: { contains: q, mode: 'insensitive' } },
            select: { id: true, name: true, phone: true },
            take: 5,
          }),
          prisma.product.findMany({
            where: { name: { contains: q, mode: 'insensitive' } },
            select: { id: true, name: true, sku: true },
            take: 5,
          }),
          prisma.transaction.findMany({
            where: {
              OR: [
                { description: { contains: q, mode: 'insensitive' } },
                { category: { contains: q, mode: 'insensitive' } },
              ],
            },
            select: { id: true, date: true, type: true, amountInToman: true, description: true },
            orderBy: { date: 'desc' },
            take: 5,
          }),
          prisma.order.findMany({
            where: { customer: { name: { contains: q, mode: 'insensitive' } } },
            select: { id: true, number: true, status: true, totalAmount: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 5,
          }),
        ]);

        return NextResponse.json({
          customers,
          products,
          transactions: txs.map((t: any) => ({
            ...t,
            amountInToman: Number(t.amountInToman),
          })),
          orders: orders.map((o: any) => ({
            ...o,
            totalAmount: Number(o.totalAmount),
          })),
        });
      }

      // ── انبارها (برای پنل سایت) ─────────────────────────────────────────────
      case 'warehouses': {
        // Archived and consignment (virtual) warehouses are not places the site sells from.
        const warehouses = await prisma.warehouse.findMany({
          where: { isArchived: false, isVirtual: false },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        });
        return NextResponse.json(warehouses);
      }

      // ── موجودی یک انبار برای سایت ───────────────────────────────────────────
      case 'stock': {
        const warehouseId = searchParams.get('warehouseId') ?? '';
        const warehouse = warehouseId
          ? await prisma.warehouse.findFirst({
              where: { id: warehouseId, isArchived: false, isVirtual: false },
              select: { id: true },
            })
          : null;
        // 422, not 400/404: the site reads those as "the ERP does not have this
        // action yet" and would hide the error.
        if (!warehouse)
          return NextResponse.json(
            { error: 'warehouseId نامعتبر است؛ یکی از انبارهای فهرست warehouses را بفرستید.' },
            { status: 422 },
          );

        // Stamped before reading: the site orders its readings by `at`, and this
        // keeps both the webhook and this feed on the ERP's clock.
        const at = new Date().toISOString();
        // Every product the site knows (webId set), including those with no
        // stock row in this warehouse: the site needs the zeros too.
        const products = await prisma.product.findMany({
          where: { webId: { not: null } },
          select: {
            webId: true,
            sku: true,
            name: true,
            sellPrice: true,
            inventory: { where: { warehouseId }, select: { quantity: true } },
          },
          orderBy: { webId: 'asc' },
        });
        return NextResponse.json({
          at,
          items: products.map((p: any) => ({
            webId: p.webId,
            sku: p.sku,
            name: p.name,
            // The ERP keeps a negative row (and its «کسری موجودی» tag); for the site it is simply none left.
            quantity: Math.max(0, p.inventory[0]?.quantity ?? 0),
            price: Math.round(Number(p.sellPrice)),
          })),
        });
      }

      default:
        return unknownGetAction();
    }
  } catch (err: any) {
    console.error('[ERP API]', err);
    return NextResponse.json({ error: err.message ?? 'Internal error' }, { status: 500 });
  }
}

// ── Money writes (full key): deposit, expense, transfer ─────────────────────

const CURRENCIES = ['TOMAN', 'USD', 'EUR', 'CNY'];

/** A refusal the caller can fix: 422 with the message. */
class Refused extends Error {}
class NoRate extends Error {}

type MoneyInput = { amount: number; currency: string | null; date: Date; requestId: string | null };

/**
 * The fields every money write shares, or why they are refused (422): an
 * amount above zero, a known currency if one is given, a Gregorian date (a
 * Jalali «1405-06-30» would be stored as the year 1405 and vanish from the
 * journal), and the caller's requestId, which books a repeated call once.
 */
function readMoneyInput(fields: Record<string, unknown>): MoneyInput | string {
  const raw = fields.amount;
  const amount = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) return 'amount must be a number greater than 0.';

  const currency = fields.currency == null || fields.currency === '' ? null : fields.currency;
  if (currency !== null && (typeof currency !== 'string' || !CURRENCIES.includes(currency)))
    return `currency must be one of ${CURRENCIES.join(', ')}; leave it out to use the account's own currency.`;

  let date = new Date();
  if (fields.date != null && fields.date !== '') {
    const value = fields.date;
    if (typeof value !== 'string') return 'date must be a Gregorian date string, YYYY-MM-DD.';
    if (/^\s*1[34]\d\d(\D|$)/.test(value))
      return `date "${value}" looks like a Jalali (Shamsi) date; send the Gregorian date, e.g. 2026-09-21.`;
    date = new Date(value);
    if (Number.isNaN(date.getTime())) return `date "${value}" is not a valid date; use YYYY-MM-DD.`;
    if (date.getUTCFullYear() < 1900)
      return `date "${value}" is before 1900; send the Gregorian date, e.g. 2026-09-21.`;
  }

  // An id the ERP cannot store would be dropped, and a retry would then book twice.
  const requestId = readRequestId(fields.requestId);
  if (!requestId && fields.requestId != null && fields.requestId !== '')
    return 'requestId must be 8-64 letters, digits, - or _; leave it out to book without one.';

  return { amount, currency, date, requestId };
}

/** Toman per unit of `currency`, from its latest rate. */
async function rateToToman(client: any, currency: string): Promise<number> {
  if (currency === 'TOMAN') return 1;
  const r = await client.exchangeRate.findFirst({ where: { currency }, orderBy: { date: 'desc' } });
  if (!r) throw new NoRate(`No exchange rate for ${currency}`);
  return Number(r.rateToToman);
}

/**
 * True when this requestId is already on a booked row: a repeat that arrives
 * after the first call finished (the account lock makes it wait for it). A
 * repeat that races the first is stopped by the unique column instead.
 */
async function alreadyBooked(tx: any, requestId: string | null): Promise<boolean> {
  return !!requestId && !!(await tx.transaction.findUnique({ where: { clientRequestId: requestId }, select: { id: true } }));
}

/** An API transfer's text on its outgoing leg, without a leading «[ورود]». */
function outgoingText(text: string): string {
  return text.replace(/^(\s*\[ورود\])+/, '').trim();
}

/** One booked row as a money write answers it: the account's balance is the one after the write. */
function rowReply(t: any, balance: unknown) {
  return {
    id: t.id,
    type: t.type,
    accountId: t.accountId,
    amount: Number(t.amount),
    currency: t.currency,
    amountInToman: Number(t.amountInToman),
    date: t.date,
    balance: Number(balance),
  };
}

/** A requestId already booked: the rows it booked, with each account's balance now. Nothing new is written. */
async function repeatedReply(requestId: string) {
  const first = await prisma.transaction.findUnique({ where: { clientRequestId: requestId } });
  // The row carrying the id first: for a transfer, the outgoing leg, then the incoming one.
  const rows = !first
    ? []
    : first.transferGroupId
      ? [first, ...(await prisma.transaction.findMany({ where: { transferGroupId: first.transferGroupId, id: { not: first.id } } }))]
      : [first];
  const accounts = await prisma.account.findMany({
    where: { id: { in: rows.map((t: any) => t.accountId).filter(Boolean) } },
    select: { id: true, balance: true },
  });
  const balanceOf = (id: string) => accounts.find((a: any) => a.id === id)?.balance;
  return NextResponse.json({
    success: true,
    duplicate: true,
    message: DUPLICATE_REQUEST_MESSAGE,
    transactions: rows.map((t: any) => rowReply(t, balanceOf(t.accountId))),
  });
}

// ── POST /api/erp  body: { action, ...fields } ───────────────────────────────
const POST_ACTIONS = ['deposit', 'expense', 'transfer', 'createSale', 'setSaleStatus'];

function unknownPostAction() {
  return NextResponse.json({ error: 'Unknown action', availableActions: POST_ACTIONS }, { status: 404 });
}

export async function POST(req: NextRequest) {
  const key = authenticate(req);
  if (!key) return unauthorized();
  // The spec writes the address as /api/erp?action=…, so the action may come
  // there instead of in the body. The body's wins when both name one.
  const queryAction = req.nextUrl.searchParams.get('action');

  // A bad body is 422: the site reads 400 and 404 as "the ERP does not have
  // this action yet" and would hide the error.
  let body: any;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    // An action the ERP does not have is 404, whatever body came with it.
    if (queryAction && !POST_ACTIONS.includes(queryAction)) return unknownPostAction();
    // A real action this key may not call is 403, whatever body came with it.
    if (key === 'site' && queryAction && !SITE_POST_ACTIONS.includes(queryAction)) return forbidden();
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 422 });
  }

  const { action: bodyAction, ...fields } = body;
  const action = bodyAction ?? queryAction;
  // The site key runs nothing outside its list: a real action is 403, any other still 404.
  if (key === 'site' && !SITE_POST_ACTIONS.includes(action))
    return POST_ACTIONS.includes(action) ? forbidden() : unknownPostAction();

  try {
    switch (action) {
      // ── ثبت واریز / ثبت هزینه یا پرداخت ─────────────────────────────────────
      case 'deposit':
      case 'expense': {
        const { accountId, description, category, payee } = fields;
        if (!accountId || fields.amount == null || fields.amount === '' || !description)
          return NextResponse.json({ error: 'accountId, amount, description required' }, { status: 400 });
        const input = readMoneyInput(fields);
        if (typeof input === 'string') return NextResponse.json({ error: input }, { status: 422 });
        const income = action === 'deposit';

        try {
          const row = await prisma.$transaction(async (tx: any) => {
            const [acct] = await tx.$queryRaw`SELECT id, currency, balance FROM "Account" WHERE id = ${accountId} FOR UPDATE`;
            if (!acct) throw new Error('Account not found');
            if (await alreadyBooked(tx, input.requestId)) return null;
            // The amount is in `currency`, the account's own unless the caller says otherwise.
            const currency = input.currency ?? acct.currency;
            const rate = await rateToToman(tx, currency);
            const amountInToman = input.amount * rate;
            // The money moves in the account's own currency.
            const booked =
              currency === acct.currency ? { amount: input.amount, rate } : await inAccountCurrency(tx, acct, amountInToman);
            if (!income && Number(acct.balance) < booked.amount) throw new Error('Insufficient balance');

            const created = await tx.transaction.create({
              data: {
                amount: new Prisma.Decimal(booked.amount),
                currency: acct.currency,
                rateSnapshot: new Prisma.Decimal(booked.rate),
                amountInToman: new Prisma.Decimal(amountInToman),
                type: income ? 'INCOME' : 'EXPENSE',
                accountId,
                category: category ?? (income ? 'واریز' : 'هزینه'),
                description,
                ...(income ? {} : { payee: payee ?? null }),
                date: input.date,
                clientRequestId: input.requestId ?? undefined,
              },
            });
            const updated = await tx.account.update({
              where: { id: accountId },
              data: {
                balance: income
                  ? { increment: new Prisma.Decimal(booked.amount) }
                  : { decrement: new Prisma.Decimal(booked.amount) },
              },
              select: { balance: true },
            });
            return rowReply(created, updated.balance);
          });
          if (!row) return repeatedReply(input.requestId as string);
          return NextResponse.json({
            success: true,
            message: income ? 'واریز ثبت شد' : 'هزینه ثبت شد',
            transactions: [row],
          });
        } catch (err) {
          if (input.requestId && isDuplicateRequest(err)) return repeatedReply(input.requestId);
          if (err instanceof NoRate) return NextResponse.json({ error: err.message }, { status: 400 });
          throw err;
        }
      }

      // ── انتقال وجه داخلی ─────────────────────────────────────────────────────
      case 'transfer': {
        const { fromAccountId, toAccountId, description } = fields;
        if (!fromAccountId || !toAccountId || fields.amount == null || fields.amount === '')
          return NextResponse.json({ error: 'fromAccountId, toAccountId, amount required' }, { status: 400 });
        if (fromAccountId === toAccountId)
          return NextResponse.json({ error: 'Source and destination must differ' }, { status: 400 });
        const input = readMoneyInput(fields);
        if (typeof input === 'string') return NextResponse.json({ error: input }, { status: 422 });
        const amount = input.amount;
        const text = typeof description === 'string' && description.trim() ? description : null;

        try {
          const rows = await prisma.$transaction(async (tx: any) => {
            // Both rows, locked in a fixed order so two opposite transfers cannot deadlock.
            const locked = await tx.$queryRaw`
              SELECT id, name, currency, balance FROM "Account"
              WHERE id IN (${fromAccountId}, ${toAccountId}) ORDER BY id FOR UPDATE`;
            const from = locked.find((a: any) => a.id === fromAccountId);
            const to = locked.find((a: any) => a.id === toAccountId);
            if (!from || !to) throw new Error('Account not found');
            if (await alreadyBooked(tx, input.requestId)) return null;
            if (from.currency !== to.currency)
              throw new Error(`Currency mismatch: ${from.currency} ≠ ${to.currency}`);
            if (input.currency && input.currency !== from.currency)
              throw new Refused(`currency ${input.currency} does not match the accounts' currency ${from.currency}`);
            if (Number(from.balance) < amount)
              throw new Error('Insufficient balance in source account');

            // The two legs share one id, so they read as one transfer.
            const transferGroupId = randomUUID();
            const debit = await tx.transaction.create({
              data: {
                amount: new Prisma.Decimal(amount),
                currency: from.currency,
                rateSnapshot: new Prisma.Decimal(1),
                amountInToman: new Prisma.Decimal(amount),
                type: 'TRANSFER',
                accountId: fromAccountId,
                category: 'انتقال داخلی',
                // An unprefixed TRANSFER is the outgoing leg; one starting with
                // «[ورود]» would be read as incoming (balanceEffect).
                description: (text && outgoingText(text)) || `انتقال به ${to.name}`,
                date: input.date,
                transferGroupId,
                clientRequestId: input.requestId ?? undefined,
              },
            });
            const credit = await tx.transaction.create({
              data: {
                amount: new Prisma.Decimal(amount),
                currency: to.currency,
                rateSnapshot: new Prisma.Decimal(1),
                amountInToman: new Prisma.Decimal(amount),
                type: 'INCOME',
                accountId: toAccountId,
                category: 'انتقال داخلی',
                description: text ?? `انتقال از ${from.name}`,
                date: input.date,
                transferGroupId,
              },
            });
            const fromNow = await tx.account.update({
              where: { id: fromAccountId },
              data: { balance: { decrement: new Prisma.Decimal(amount) } },
              select: { balance: true },
            });
            const toNow = await tx.account.update({
              where: { id: toAccountId },
              data: { balance: { increment: new Prisma.Decimal(amount) } },
              select: { balance: true },
            });
            return [rowReply(debit, fromNow.balance), rowReply(credit, toNow.balance)];
          });
          if (!rows) return repeatedReply(input.requestId as string);
          return NextResponse.json({ success: true, message: 'انتقال وجه انجام شد', transactions: rows });
        } catch (err) {
          if (input.requestId && isDuplicateRequest(err)) return repeatedReply(input.requestId);
          if (err instanceof Refused) return NextResponse.json({ error: err.message }, { status: 422 });
          throw err;
        }
      }

      // ── فروش سایت ────────────────────────────────────────────────────────────
      case 'createSale':
      case 'setSaleStatus': {
        const result =
          action === 'createSale' ? await createSale(prisma, fields) : await setSaleStatus(prisma, fields);
        // Not after createSale: the site already took its own sale off, and a count
        // landing before it has recorded this answer would be subtracted twice.
        if (action === 'setSaleStatus') kickSiteHook();
        return NextResponse.json(result.body, { status: result.status });
      }

      default:
        return unknownPostAction();
    }
  } catch (err: any) {
    console.error('[ERP API POST]', err);
    return NextResponse.json({ error: err.message ?? 'Internal error' }, { status: 500 });
  }
}
