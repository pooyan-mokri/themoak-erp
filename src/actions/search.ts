'use server';

import { prisma } from '@/lib/prisma';

export interface SearchResult {
  type: 'order' | 'customer' | 'product' | 'transaction' | 'purchase';
  id: string;
  title: string;
  subtitle?: string;
  amount?: number;
  currency?: string;
  href: string;
  date?: Date;
}

export async function globalSearch(query: string): Promise<SearchResult[]> {
  if (!query || query.trim().length < 2) return [];
  const q = query.trim();

  const results: SearchResult[] = [];

  const [customers, products, orders, transactions, purchases] = await Promise.all([
    // Customers
    prisma.customer.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 5,
    }),

    // Products
    prisma.product.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { sku: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 5,
    }),

    // Orders (by number or customer name)
    prisma.order.findMany({
      where: {
        OR: [
          ...(isNaN(Number(q)) ? [] : [{ number: { equals: Number(q) } }]),
          { customer: { name: { contains: q, mode: 'insensitive' } } },
          { tags: { has: q } },
        ],
      },
      include: { customer: true },
      take: 5,
      orderBy: { createdAt: 'desc' },
    }),

    // Transactions
    prisma.transaction.findMany({
      where: {
        OR: [
          { description: { contains: q, mode: 'insensitive' } },
          { category: { contains: q, mode: 'insensitive' } },
          { payee: { contains: q, mode: 'insensitive' } },
          { tags: { has: q } },
        ],
      },
      include: { account: true },
      take: 5,
      orderBy: { date: 'desc' },
    }),

    // Purchase orders
    prisma.purchaseOrder.findMany({
      where: {
        OR: [
          { supplier: { name: { contains: q, mode: 'insensitive' } } },
          { tags: { has: q } },
        ],
      },
      include: { supplier: true },
      take: 5,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  customers.forEach((c: any) => {
    results.push({
      type: 'customer',
      id: c.id,
      title: c.name,
      subtitle: c.phone || c.email || 'مشتری',
      href: `/dashboard/sales/customers/${c.id}`,
      date: c.createdAt,
    });
  });

  products.forEach((p: any) => {
    results.push({
      type: 'product',
      id: p.id,
      title: p.name,
      subtitle: `کد: ${p.sku}`,
      amount: Number(p.sellPrice),
      href: `/dashboard/inventory/products/${p.id}`,
      date: p.createdAt,
    });
  });

  orders.forEach((o: any) => {
    results.push({
      type: 'order',
      id: o.id,
      title: `فاکتور #${o.number}`,
      subtitle: o.customer?.name || '',
      amount: Number(o.totalAmount || 0),
      href: `/dashboard/sales/orders/${o.id}`,
      date: o.createdAt,
    });
  });

  transactions.forEach((t: any) => {
    results.push({
      type: 'transaction',
      id: t.id,
      title: t.description || t.category || 'تراکنش',
      subtitle: t.account?.name || '',
      amount: Number(t.amountInToman),
      currency: t.currency,
      href: `/dashboard/accounting/transactions`,
      date: t.date,
    });
  });

  purchases.forEach((p: any) => {
    results.push({
      type: 'purchase',
      id: p.id,
      title: `سفارش خرید - ${p.supplier?.name || ''}`,
      subtitle: p.notes || '',
      amount: Number(p.totalAmount || 0),
      href: `/dashboard/purchasing/${p.id}`,
      date: p.createdAt,
    });
  });

  // Sort by date desc
  results.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

  return results;
}
