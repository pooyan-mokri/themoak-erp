import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { inAccountCurrency } from '@/lib/balance-reconciliation';
import { createSale, setSaleStatus } from '@/lib/site-sale';
import { kickSiteHook } from '@/lib/site-hook';

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
            items: true,
            commissions: true,
          },
          orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json(
          orders.map((o: any) => {
            const gross = o.items.reduce(
              (s: number, i: any) => s + i.quantity * Number(i.price),
              0,
            );
            const commission = o.commissions?.[0]
              ? Number(o.commissions[0].commissionAmount)
              : 0;
            return {
              id: o.id,
              number: o.number,
              partner: o.customer?.name ?? null,
              grossAmount: gross,
              commissionAmount: commission,
              netAmount: gross - commission,
              paidAmount: Number(o.paidAmount),
              remainingAmount: gross - commission - Number(o.paidAmount),
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
      // ── ثبت واریز ────────────────────────────────────────────────────────────
      case 'deposit': {
        const { accountId, amount, currency = 'TOMAN', description, category, date } = fields;
        if (!accountId || !amount || !description)
          return NextResponse.json({ error: 'accountId, amount, description required' }, { status: 400 });

        let rate = 1;
        if (currency !== 'TOMAN') {
          const r = await prisma.exchangeRate.findFirst({
            where: { currency },
            orderBy: { date: 'desc' },
          });
          if (!r) return NextResponse.json({ error: `No exchange rate for ${currency}` }, { status: 400 });
          rate = Number(r.rateToToman);
        }
        const amountInToman = amount * rate;

        await prisma.$transaction(async (tx: any) => {
          const acct = await tx.account.findUnique({ where: { id: accountId } });
          if (!acct) throw new Error('Account not found');
          // The money lands in the account in the account's own currency.
          const { amount: amountInAccountCurrency, rate: accountRate } =
            await inAccountCurrency(tx, acct, amountInToman);

          await tx.transaction.create({
            data: {
              amount: new Prisma.Decimal(amountInAccountCurrency),
              currency: acct.currency,
              rateSnapshot: new Prisma.Decimal(accountRate),
              amountInToman: new Prisma.Decimal(amountInToman),
              type: 'INCOME',
              accountId,
              category: category ?? 'واریز',
              description,
              date: date ? new Date(date) : new Date(),
            },
          });
          await tx.account.update({
            where: { id: accountId },
            data: { balance: { increment: new Prisma.Decimal(amountInAccountCurrency) } },
          });
        });
        return NextResponse.json({ success: true, message: 'واریز ثبت شد' });
      }

      // ── ثبت هزینه / پرداخت ───────────────────────────────────────────────────
      case 'expense': {
        const { accountId, amount, currency = 'TOMAN', description, category, payee, date } = fields;
        if (!accountId || !amount || !description)
          return NextResponse.json({ error: 'accountId, amount, description required' }, { status: 400 });

        let rate = 1;
        if (currency !== 'TOMAN') {
          const r = await prisma.exchangeRate.findFirst({
            where: { currency },
            orderBy: { date: 'desc' },
          });
          if (!r) return NextResponse.json({ error: `No exchange rate for ${currency}` }, { status: 400 });
          rate = Number(r.rateToToman);
        }
        const amountInToman = amount * rate;

        await prisma.$transaction(async (tx: any) => {
          const acct = await tx.account.findUnique({ where: { id: accountId } });
          if (!acct) throw new Error('Account not found');
          // The money leaves the account in the account's own currency.
          const { amount: amountInAccountCurrency, rate: accountRate } =
            await inAccountCurrency(tx, acct, amountInToman);
          if (Number(acct.balance) < amountInAccountCurrency)
            throw new Error('Insufficient balance');

          await tx.transaction.create({
            data: {
              amount: new Prisma.Decimal(amountInAccountCurrency),
              currency: acct.currency,
              rateSnapshot: new Prisma.Decimal(accountRate),
              amountInToman: new Prisma.Decimal(amountInToman),
              type: 'EXPENSE',
              accountId,
              category: category ?? 'هزینه',
              description,
              payee: payee ?? null,
              date: date ? new Date(date) : new Date(),
            },
          });
          await tx.account.update({
            where: { id: accountId },
            data: { balance: { decrement: new Prisma.Decimal(amountInAccountCurrency) } },
          });
        });
        return NextResponse.json({ success: true, message: 'هزینه ثبت شد' });
      }

      // ── انتقال وجه داخلی ─────────────────────────────────────────────────────
      case 'transfer': {
        const { fromAccountId, toAccountId, amount, description, date } = fields;
        if (!fromAccountId || !toAccountId || !amount)
          return NextResponse.json({ error: 'fromAccountId, toAccountId, amount required' }, { status: 400 });
        if (fromAccountId === toAccountId)
          return NextResponse.json({ error: 'Source and destination must differ' }, { status: 400 });

        await prisma.$transaction(async (tx: any) => {
          const from = await tx.account.findUnique({ where: { id: fromAccountId } });
          const to = await tx.account.findUnique({ where: { id: toAccountId } });
          if (!from || !to) throw new Error('Account not found');
          if (from.currency !== to.currency)
            throw new Error(`Currency mismatch: ${from.currency} ≠ ${to.currency}`);
          if (Number(from.balance) < amount)
            throw new Error('Insufficient balance in source account');

          const now = date ? new Date(date) : new Date();
          await tx.transaction.create({
            data: {
              amount: new Prisma.Decimal(amount),
              currency: from.currency,
              rateSnapshot: new Prisma.Decimal(1),
              amountInToman: new Prisma.Decimal(amount),
              type: 'TRANSFER',
              accountId: fromAccountId,
              category: 'انتقال داخلی',
              description: description ?? `انتقال به ${to.name}`,
              date: now,
            },
          });
          await tx.transaction.create({
            data: {
              amount: new Prisma.Decimal(amount),
              currency: to.currency,
              rateSnapshot: new Prisma.Decimal(1),
              amountInToman: new Prisma.Decimal(amount),
              type: 'INCOME',
              accountId: toAccountId,
              category: 'انتقال داخلی',
              description: description ?? `انتقال از ${from.name}`,
              date: now,
            },
          });
          await tx.account.update({
            where: { id: fromAccountId },
            data: { balance: { decrement: new Prisma.Decimal(amount) } },
          });
          await tx.account.update({
            where: { id: toAccountId },
            data: { balance: { increment: new Prisma.Decimal(amount) } },
          });
        });
        return NextResponse.json({ success: true, message: 'انتقال وجه انجام شد' });
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
