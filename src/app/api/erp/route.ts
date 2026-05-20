import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

// ── Auth helper ──────────────────────────────────────────────────────────────
function authenticate(req: NextRequest): boolean {
  const secret = process.env.ERP_API_SECRET;
  if (!secret) return false; // secret must be set
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${secret}`;
}

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

// ── GET /api/erp?action=<action>&... ─────────────────────────────────────────
export async function GET(req: NextRequest) {
  if (!authenticate(req)) return unauthorized();

  const { searchParams } = req.nextUrl;
  const action = searchParams.get('action') ?? '';

  try {
    switch (action) {
      // ── خلاصه مالی ─────────────────────────────────────────────────────────
      case 'summary': {
        const accounts = await prisma.account.findMany();
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
          accounts: accounts.length,
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

      default:
        return NextResponse.json(
          {
            error: 'Unknown action',
            availableActions: [
              'summary',
              'accounts',
              'transactions',
              'orders',
              'settlements',
              'loans',
              'search',
            ],
          },
          { status: 400 },
        );
    }
  } catch (err: any) {
    console.error('[ERP API]', err);
    return NextResponse.json({ error: err.message ?? 'Internal error' }, { status: 500 });
  }
}

// ── POST /api/erp  body: { action, ...fields } ───────────────────────────────
export async function POST(req: NextRequest) {
  if (!authenticate(req)) return unauthorized();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { action, ...fields } = body;

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
          await tx.transaction.create({
            data: {
              amount: new Prisma.Decimal(amount),
              currency,
              rateSnapshot: new Prisma.Decimal(rate),
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
            data: { balance: { increment: new Prisma.Decimal(amountInToman) } },
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
          if (Number(acct.balance) < amountInToman)
            throw new Error('Insufficient balance');

          await tx.transaction.create({
            data: {
              amount: new Prisma.Decimal(amount),
              currency,
              rateSnapshot: new Prisma.Decimal(rate),
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
            data: { balance: { decrement: new Prisma.Decimal(amountInToman) } },
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

      default:
        return NextResponse.json(
          {
            error: 'Unknown action',
            availableActions: ['deposit', 'expense', 'transfer'],
          },
          { status: 400 },
        );
    }
  } catch (err: any) {
    console.error('[ERP API POST]', err);
    return NextResponse.json({ error: err.message ?? 'Internal error' }, { status: 500 });
  }
}
