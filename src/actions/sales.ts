'use server';

/**
 * Sales Actions - فروش و سفارشات
 * - ایجاد سفارش
 * - مدیریت پرداخت‌ها
 * - لغو سفارشات
 * - دریافت لیست سفارشات
 */

import { TransactionType } from '@/lib/types';
import { PrismaClient, Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';

import { prisma } from '@/lib/prisma';
import { restoreOrderItemStock } from '@/lib/restore-warehouse';
import { balanceEffect } from '@/lib/balance-reconciliation';
import { WEBSITE_ORDER_LOCKED, readSiteOrderData } from '@/lib/site-sale-data';
import { kickSiteHook } from '@/lib/site-hook';
import { checkPermission, getCurrentRole, hasPermission, requirePermission } from '@/lib/access';
import { PAYMENT_ACCOUNT_TYPE_MESSAGE, accountForViewer, bookOrderPayment, productForViewer } from '@/lib/sales-records';
import { DUPLICATE_REQUEST_MESSAGE, isDuplicateRequest, readRequestId } from '@/lib/request-id';
import { accountLabel } from '@/lib/account-label';

// const prisma = new PrismaClient();



interface CartItem {
  productId: string;
  quantity: number;
  price: number;
}

interface OrderData {
  customerId: string;
  items: CartItem[];
  paymentMethod: 'CASH' | 'ACCOUNT';
  accountId: string; // Cash Box or Bank Account ID
  totalAmount: number;
  discount?: number;
  paidAmount?: number;
  warehouseId?: string; // Which warehouse to deduct stock from
  saleDate?: string; // ISO date string for the sale; defaults to now
  tags?: string[];
  invoiceAccountId?: string; // Account whose card/IBAN to show on credit invoice
  requestId?: string; // One checkout submission (src/lib/request-id.ts)
}

export async function createOrder(data: OrderData) {
  const denied = await checkPermission('sales.manage');
  if (denied) return denied;
  const { customerId, items, paymentMethod, accountId, totalAmount, discount = 0, paidAmount, warehouseId, saleDate, tags = [], invoiceAccountId } = data;
  const orderDate = saleDate ? new Date(saleDate) : new Date();
  const requestId = readRequestId(data.requestId);

  if (!items.length) {
    return { success: false, message: 'سبد خرید خالی است.' };
  }

  // Calculate final amounts
  const finalPaidAmount = paidAmount !== undefined ? paidAmount : (totalAmount - discount);
  const debtAmount = (totalAmount - discount) - finalPaidAmount;

  // A negative payment would leave the order owing more than its price, and
  // «ثبت پرداخت» would then book the excess as received.
  if (!(finalPaidAmount >= 0)) {
    return { success: false, message: 'مبلغ پرداختی نمی‌تواند منفی باشد.' };
  }

  // Money beyond the price would be booked as received and the order marked PAID.
  if (finalPaidAmount > totalAmount - discount) {
    return { success: false, message: 'مبلغ پرداختی نمی‌تواند بیشتر از مبلغ قابل پرداخت (پس از تخفیف) باشد.' };
  }

  try {
    await prisma.$transaction(async (tx: any) => {
      let transactionId = undefined;

      // 1. Fetch customer first to get name for transaction description
      let customer = undefined;
      if (customerId) {
        customer = await tx.customer.findUnique({
          where: { id: customerId },
          include: {
            warehouses: {
              where: { isVirtual: true },
            },
          },
        });
      }

      // 2. Create Transaction (Income) ONLY if there is a payment
      if (finalPaidAmount > 0) {
        const customerName = customer?.name || 'مشتری عمومی';

        // POS prices are in TOMAN — convert to the account's currency
        // when the cashier collects to a foreign-currency account.
        const account = await tx.account.findUnique({ where: { id: accountId } });
        if (!account) {
          throw new Error('حساب دریافت وجه یافت نشد.');
        }
        // cancelOrder takes back what a row added only on real-money accounts.
        if (account.type !== 'BANK' && account.type !== 'CASH') {
          throw new Error(PAYMENT_ACCOUNT_TYPE_MESSAGE);
        }
        let rate = 1;
        if (account.currency !== 'TOMAN') {
          const latestRate = await tx.exchangeRate.findFirst({
            where: { currency: account.currency },
            orderBy: { date: 'desc' },
          });
          if (!latestRate) {
            throw new Error(`نرخ تبدیل برای ارز ${account.currency} یافت نشد. لطفا ابتدا نرخ امروز را وارد کنید.`);
          }
          rate = Number(latestRate.rateToToman);
        }
        const amountInAccountCurrency = finalPaidAmount / rate;

        const transaction = await tx.transaction.create({
          data: {
            amount: new Prisma.Decimal(amountInAccountCurrency),
            currency: account.currency,
            rateSnapshot: new Prisma.Decimal(rate),
            amountInToman: new Prisma.Decimal(finalPaidAmount),
            type: TransactionType.INCOME,
            accountId: accountId,
            customerId: customerId || undefined,
            description: `سفارش فروش - مشتری: ${customerName}`,
            category: 'Sales',
            date: orderDate,
            clientRequestId: requestId ?? undefined,
          },
        });
        transactionId = transaction.id;

        // 3. Update Account Balance in the account's own currency
        await tx.account.update({
          where: { id: accountId },
          data: {
            balance: { increment: new Prisma.Decimal(amountInAccountCurrency) },
          },
        });
      }

      // 4. Resolve which warehouse each item is deducted from BEFORE creating
      // OrderItems so we can persist warehouseId per item.
      const itemWarehouses: string[] = [];
      for (const item of items) {
        if (warehouseId) {
          itemWarehouses.push(warehouseId);
        } else {
          const inv = await tx.inventory.findFirst({
            where: { productId: item.productId, quantity: { gte: item.quantity } },
          });
          if (!inv) {
            const product = await tx.product.findUnique({ where: { id: item.productId }, select: { name: true } });
            throw new Error(`موجودی کافی برای محصول "${product?.name || item.productId}" وجود ندارد.`);
          }
          itemWarehouses.push(inv.warehouseId);
        }
      }

      // 5. Create Order
      const order = await tx.order.create({
        data: {
          customerId,
          totalAmount,
          discount,
          paidAmount: finalPaidAmount,
          paymentStatus: debtAmount > 0 ? (finalPaidAmount > 0 ? 'PARTIAL' : 'UNPAID') : 'PAID',
          status: 'COMPLETED',
          transactionId: transactionId,
          createdAt: orderDate,
          tags,
          invoiceAccountId: invoiceAccountId ?? null,
          items: {
            create: items.map((item: any, idx: number) => ({
              productId: item.productId,
              quantity: item.quantity,
              price: item.price,
              warehouseId: itemWarehouses[idx],
            })),
          },
        },
      });

      // The checkout money belongs to this order (cancelOrder reverses by it).
      if (transactionId) {
        await tx.transaction.update({ where: { id: transactionId }, data: { orderId: order.id } });
      }

      // 5. Calculate and record commission if customer is a consignment partner
      if (customer && customer.commissionRate && customer.warehouses.length > 0) {
        const commissionRate = Number(customer.commissionRate);
        const orderAmount = Number(totalAmount) - Number(discount);
        const commissionAmount = (orderAmount * commissionRate) / 100;

        if (commissionAmount > 0) {
          await tx.consignmentCommission.create({
            data: {
              customerId: customer.id,
              orderId: order.id,
              commissionRate: new Prisma.Decimal(commissionRate),
              orderAmount: new Prisma.Decimal(orderAmount),
              commissionAmount: new Prisma.Decimal(commissionAmount),
              isPaid: false,
            },
          });
        }
      }

      // 7. Deduct inventory from the resolved warehouse for each item.
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const whId = itemWarehouses[i];
        const inventory = await tx.inventory.findUnique({
          where: {
            productId_warehouseId: { productId: item.productId, warehouseId: whId },
          },
        });

        if (!inventory || inventory.quantity < item.quantity) {
          const product = await tx.product.findUnique({ where: { id: item.productId }, select: { name: true } });
          throw new Error(`موجودی کافی برای محصول "${product?.name || item.productId}" در انبار انتخابی وجود ندارد.`);
        }

        await tx.inventory.update({
          where: {
            productId_warehouseId: { productId: item.productId, warehouseId: whId },
          },
          data: {
            quantity: { decrement: item.quantity },
          },
        });
      }
    });
    kickSiteHook();

    try {
      revalidatePath('/dashboard/sales');
      revalidatePath('/dashboard/inventory');
    } catch (error) {
      // Ignore revalidatePath error outside of Next.js context
    }
    return { success: true, message: 'سفارش با موفقیت ثبت شد.' };

  } catch (error: any) {
    // The same checkout reached the server twice: the first one is the sale.
    if (isDuplicateRequest(error)) return { success: true, message: DUPLICATE_REQUEST_MESSAGE };
    console.error(error);
    return { success: false, message: error.message || 'خطا در ثبت سفارش.' };
  }
}

export async function getOrders() {
  await requirePermission('sales.view');
  const canSeeCost = await hasPermission('cost.view');
  try {
    const orders = await prisma.order.findMany({
      include: {
        customer: true,
        items: {
          include: {
            product: true,
            warehouse: { select: { id: true, name: true } },
          },
        },
        siteRefunds: { select: { refundId: true, amount: true, at: true }, orderBy: { at: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map((order: any) => ({
      ...order,
      customerId: order.customerId ?? undefined,
      transactionId: order.transactionId ?? undefined,
      wooId: order.wooId ?? undefined,
      invoiceId: order.invoiceId ?? undefined,
      totalAmount: Number(order.totalAmount),
      discount: Number(order.discount),
      paidAmount: Number(order.paidAmount),
      siteReference: order.siteReference ?? undefined,
      siteData: readSiteOrderData(order.siteData) ?? undefined,
      siteRefunds: order.siteRefunds.map((refund: any) => ({
        refundId: refund.refundId,
        amount: Number(refund.amount),
        at: refund.at,
      })),
      customer: order.customer ? {
        ...order.customer,
        phone: order.customer.phone ?? undefined,
        email: order.customer.email ?? undefined,
        address: order.customer.address ?? undefined,
        wooId: order.customer.wooId ?? undefined,
        notes: order.customer.notes ?? undefined,
        creditLimit: Number(order.customer.creditLimit),
        segment: order.customer.segment ?? undefined,
        taxId: order.customer.taxId ?? undefined,
        commissionRate: order.customer.commissionRate ? Number(order.customer.commissionRate) : undefined,
        type: order.customer.customerType,
      } : undefined,
      items: order.items.map((item: any) => ({
        ...item,
        price: Number(item.price),
        product: item.product ? productForViewer(item.product, canSeeCost) : undefined,
      })),
    }));
  } catch (error) {
    console.error('Error fetching orders:', error);
    return [];
  }
}

// Record payment for an unpaid or partially paid order
export async function recordOrderPayment(orderId: string, accountId: string, amount: number, requestId?: string) {
  const denied = await checkPermission('sales.manage');
  if (denied) return denied;
  if (!(amount > 0)) {
    return { success: false, message: 'مبلغ پرداخت باید بیشتر از صفر باشد.' };
  }
  try {
    const outcome = await prisma.$transaction((tx: any) =>
      bookOrderPayment(tx, { orderId, accountId, amount, requestId: readRequestId(requestId) }),
    );

    revalidatePath('/dashboard/sales/history');
    revalidatePath(`/dashboard/sales/history/${orderId}`);
    return { success: true, message: outcome === 'duplicate' ? DUPLICATE_REQUEST_MESSAGE : 'پرداخت با موفقیت ثبت شد.' };
  } catch (error: any) {
    if (isDuplicateRequest(error)) return { success: true, message: DUPLICATE_REQUEST_MESSAGE };
    console.error('Error recording payment:', error);
    return { success: false, message: error.message || 'خطا در ثبت پرداخت.' };
  }
}

export async function getOrder(id: string) {
  await requirePermission('sales.view');
  const [canSeeCost, canSeeBalance] = await Promise.all([hasPermission('cost.view'), hasPermission('finance.view')]);
  try {
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        customer: {
          include: {
            warehouses: { where: { isVirtual: true } },
          },
        },
        items: {
          include: {
            product: true,
            warehouse: true,
            exchangeItems: { select: { id: true } },
            returns: { select: { quantity: true } },
            exchanges: { select: { quantity: true } },
          },
        },
        transaction: {
            include: {
                account: true
            }
        },
        invoice: true,
        commissions: true,
        siteRefunds: { select: { refundId: true, amount: true, at: true }, orderBy: { at: 'asc' } },
      },
    });
    if (!order) return undefined;
    return {
      ...order,
      customerId: order.customerId ?? undefined,
      transactionId: order.transactionId ?? undefined,
      wooId: order.wooId ?? undefined,
      invoiceId: order.invoiceId ?? undefined,
      totalAmount: Number(order.totalAmount),
      discount: Number(order.discount),
      paidAmount: Number(order.paidAmount),
      siteReference: order.siteReference ?? undefined,
      siteData: readSiteOrderData(order.siteData) ?? undefined,
      siteRefunds: order.siteRefunds.map((refund: any) => ({
        refundId: refund.refundId,
        amount: Number(refund.amount),
        at: refund.at,
      })),
      customer: order.customer ? {
        ...order.customer,
        phone: order.customer.phone ?? undefined,
        email: order.customer.email ?? undefined,
        address: order.customer.address ?? undefined,
        wooId: order.customer.wooId ?? undefined,
        notes: order.customer.notes ?? undefined,
        creditLimit: Number(order.customer.creditLimit),
        segment: order.customer.segment ?? undefined,
        taxId: order.customer.taxId ?? undefined,
        commissionRate: order.customer.commissionRate ? Number(order.customer.commissionRate) : undefined,
        type: order.customer.customerType,
      } : undefined,
      isConsignmentSale: !!(order.commissions && order.commissions.length > 0)
        || !!(order.customer && (order.customer as any).warehouses && (order.customer as any).warehouses.length > 0),
      commissions: order.commissions
        ? order.commissions.map((c: any) => ({
            ...c,
            commissionRate: Number(c.commissionRate),
            orderAmount: Number(c.orderAmount),
            commissionAmount: Number(c.commissionAmount),
          }))
        : [],
      items: order.items.map((item: any) => {
        const returnedQty = (item.returns || []).reduce(
          (s: number, r: any) => s + (r.quantity || 0), 0
        );
        const exchangedQty = (item.exchanges || []).reduce(
          (s: number, e: any) => s + (e.quantity || 0), 0
        );
        const remainingQuantity = Math.max(0, item.quantity - returnedQty - exchangedQty);
        return {
          ...item,
          price: Number(item.price),
          warehouseId: item.warehouseId ?? undefined,
          warehouse: item.warehouse
            ? { id: item.warehouse.id, name: item.warehouse.name, isVirtual: item.warehouse.isVirtual }
            : undefined,
          isExchangeDerived: !!(item.exchangeItems && item.exchangeItems.length > 0),
          remainingQuantity,
          returnedQuantity: returnedQty,
          exchangedQuantity: exchangedQty,
          // Strip the raw relations we only used for aggregation
          returns: undefined,
          exchanges: undefined,
          exchangeItems: undefined,
          product: item.product ? productForViewer(item.product, canSeeCost) : undefined,
        };
      }),
      transaction: order.transaction ? {
        ...order.transaction,
        amount: Number(order.transaction.amount),
        amountInToman: Number(order.transaction.amountInToman),
        rateSnapshot: Number(order.transaction.rateSnapshot),
        accountId: order.transaction.accountId ?? undefined,
        projectId: order.transaction.projectId ?? undefined,
        description: order.transaction.description ?? undefined,
        category: order.transaction.category ?? undefined,
        wooId: order.transaction.wooId ?? undefined,
        wooStatus: order.transaction.wooStatus ?? undefined,
        receiptUrl: order.transaction.receiptUrl ?? undefined,
        shareholderId: order.transaction.shareholderId ?? undefined,
        employeeId: order.transaction.employeeId ?? undefined,
        account: order.transaction.account ? accountForViewer(order.transaction.account, canSeeBalance) : undefined,
      } : undefined,
      invoice: order.invoice ? {
        ...order.invoice,
        subtotal: Number(order.invoice.subtotal),
        discount: Number(order.invoice.discount),
        tax: Number(order.invoice.tax),
        total: Number(order.invoice.total),
        paidAmount: Number(order.invoice.paidAmount),
        notes: order.invoice.notes ?? undefined,
      } : undefined,
    };
  } catch (error) {
    console.error('Error fetching order:', error);
    return undefined;
  }
}

// Not exported: a "use server" file may only export async functions.
const RETURNED_ORDER_MESSAGE =
  'این سفارش مرجوعی یا تعویض ثبت‌شده دارد و قابل لغو نیست؛ به‌جای لغو، اقلام باقی‌ماندهٔ آن را مرجوع کنید.';
const PREVIEW_CHANGED_MESSAGE =
  'پرداخت‌های این سفارش پس از نمایش پیغام تأیید تغییر کرده است و سفارش لغو نشد؛ دوباره «لغو» را بزنید تا مبالغ تازه را ببینید.';

type OrderMoneyRow = {
  id: string;
  type: string;
  amount: Prisma.Decimal;
  description: string | null;
  category: string | null;
  amountInToman: Prisma.Decimal | null;
  accountId: string | null;
  account: { name: string; currency: string; cardNumber: string | null; type: string } | null;
};

/** Every money row of an order: the rows that carry its id, and the row Order.transactionId points at. */
function orderMoneyRows(client: any, orderId: string, transactionId: string | null): Promise<OrderMoneyRow[]> {
  return client.transaction.findMany({
    where: { OR: [{ orderId }, ...(transactionId ? [{ id: transactionId }] : [])] },
    include: { account: { select: { name: true, currency: true, cardNumber: true, type: true } } },
    orderBy: { date: 'asc' },
  });
}

/**
 * Whether a money row moved its account's balance. The consignment COGS and
 * commission rows never did: they sit on EXPENSE accounts kept at 0 by design,
 * so removing them leaves those accounts alone. Any other row did, including a
 * legacy settlement the old modal let land on an EXPENSE account (the same rule
 * as deleteConsignmentOrder in src/actions/consignment.ts).
 */
function movesBalance(row: OrderMoneyRow): boolean {
  if (!row.account) return false;
  return !(row.account.type === 'EXPENSE' && (row.category === 'COGS' || row.category === 'CONSIGNMENT_COMMISSION'));
}

const fmt = (n: number) => Math.round(n).toLocaleString('fa-IR');

/**
 * Why this cancel must not run, or null. Two checks, on the rows the cancel would reverse:
 * - They must add up to what the order says was paid. A payment the order-link
 *   backfill could not attach (older wording, a row written during a deploy)
 *   would otherwise stay booked while the order shows nothing paid.
 * - Reversing money other people recorded after the checkout (later payments,
 *   settlements) deletes recorded bank money, which is for an admin only, like
 *   deleteConsignmentOrder.
 */
function cancelBlocker(
  rows: OrderMoneyRow[],
  order: { paidAmount: unknown; transactionId: string | null },
  isAdmin: boolean,
): string | null {
  const moving = rows.filter(movesBalance);
  const linked = moving.reduce((sum, row) => {
    const toman = Number(row.amountInToman ?? row.amount);
    return sum + (row.type === 'INCOME' ? toman : row.type === 'EXPENSE' ? -toman : 0);
  }, 0);
  const paid = Number(order.paidAmount ?? 0);
  if (Math.abs(linked - paid) > 0.5) {
    return `پرداخت‌های وصل به این سفارش (${fmt(linked)} تومان) با مبلغ پرداخت‌شدهٔ سفارش (${fmt(paid)} تومان) نمی‌خواند؛ بخشی از پول سفارش به آن وصل نیست. لغو انجام نشد تا پولی در حساب‌ها جا نماند. با مدیر سیستم تماس بگیرید.`;
  }
  if (!isAdmin && moving.some((row) => row.id !== order.transactionId)) {
    return 'دسترسی غیرمجاز — این سفارش پرداخت یا تسویهٔ ثبت‌شده بعد از فروش دارد و فقط مدیر سیستم می‌تواند آن را لغو کند.';
  }
  return null;
}

/** What removing an order's money rows does to each account, in the account's own currency. */
function reversalsByAccount(rows: OrderMoneyRow[]) {
  const byAccount = new Map<string, { label: string; currency: string | null; change: number; rows: number; moves: boolean }>();
  for (const row of rows) {
    const entry = byAccount.get(row.accountId ?? '') ?? {
      label: row.account ? accountLabel(row.account) : 'بدون حساب',
      currency: row.account?.currency ?? null,
      change: 0,
      rows: 0,
      moves: movesBalance(row),
    };
    if (entry.moves) entry.change -= balanceEffect(row);
    entry.rows += 1;
    byAccount.set(row.accountId ?? '', entry);
  }
  return Array.from(byAccount.values());
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');
}

/** Returns and exchanges moved stock and money of their own, which a cancel cannot unwind. */
async function hasReturnsOrExchanges(client: any, orderId: string): Promise<boolean> {
  const [returns, exchanges] = await Promise.all([
    client.orderReturn.count({ where: { orderId } }),
    client.orderExchange.count({ where: { orderId } }),
  ]);
  return returns + exchanges > 0;
}

/**
 * What cancelling an order would reverse on each account, for the confirm
 * dialog: the same rows and the same rule cancelOrder applies.
 */
export async function getCancelOrderPreview(orderId: string): Promise<
  | {
      success: true;
      accounts: Array<{ label: string; currency: string | null; change: number; rows: number; moves: boolean }>;
      /** The rows shown; pass them to cancelOrder so it reverses exactly these. */
      moneyRowIds: string[];
    }
  | { success: false; message: string }
> {
  const denied = await checkPermission('sales.manage');
  if (denied) return denied;
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true, siteReference: true, transactionId: true, paidAmount: true },
    });
    if (!order) return { success: false, message: 'سفارش یافت نشد.' };
    if (order.siteReference !== null) return { success: false, message: WEBSITE_ORDER_LOCKED };
    if (order.status === 'CANCELLED') return { success: false, message: 'این سفارش قبلاً لغو شده است.' };
    if (await hasReturnsOrExchanges(prisma, orderId)) return { success: false, message: RETURNED_ORDER_MESSAGE };

    const rows = await orderMoneyRows(prisma, orderId, order.transactionId);
    const blocked = cancelBlocker(rows, order, (await getCurrentRole()) === 'ADMIN');
    if (blocked) return { success: false, message: blocked };
    return { success: true, accounts: reversalsByAccount(rows), moneyRowIds: rows.map((row) => row.id) };
  } catch (error) {
    console.error('Error previewing order cancel:', error);
    return { success: false, message: 'خطا در خواندن پرداخت‌های سفارش.' };
  }
}

/**
 * لغو سفارش
 * - سفارشی که مرجوعی یا تعویض دارد لغو نمی‌شود
 * - کالاها به انبار برمی‌گردند
 * - همهٔ ردیف‌های مالی سفارش (پرداخت هنگام فروش، پرداخت‌های بعدی، تسویه‌ها)
 *   حذف و اثرشان از موجودی حساب‌ها برگردانده می‌شود
 */
export async function cancelOrder(orderId: string, expectedMoneyRowIds?: string[]): Promise<{
  success: boolean;
  message: string;
}> {
  const denied = await checkPermission('sales.manage');
  if (denied) return denied;
  const isAdmin = (await getCurrentRole()) === 'ADMIN';
  try {
    // Get order with all relations
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            product: true,
            warehouse: true,
          },
        },
        invoice: true,
      },
    });

    if (!order) {
      return { success: false, message: 'سفارش یافت نشد.' };
    }

    // Website orders are reversed on the website (setSaleStatus); cancelling
    // them here too would move their money and stock a second time.
    if (order.siteReference !== null) {
      return { success: false, message: WEBSITE_ORDER_LOCKED };
    }

    // Check if already cancelled
    if (order.status === 'CANCELLED') {
      return { success: false, message: 'این سفارش قبلاً لغو شده است.' };
    }

    // Lines deliberately not credited back (e.g. a WooCommerce order whose
    // stock was never deducted). Reported to the operator rather than hidden
    // behind a blanket success message.
    const notRestored: string[] = [];

    await prisma.$transaction(async (tx) => {
      // 1. Claim the cancellation. The status check above runs outside this
      // transaction, so two concurrent cancels could both pass it and restore
      // the stock twice. This conditional update serializes them in the DB.
      // It never claims a website order, for the same reason as the check above.
      const claimed = await tx.order.updateMany({
        where: { id: orderId, status: { not: 'CANCELLED' }, siteReference: null },
        data: {
          status: 'CANCELLED',
          paymentStatus: 'UNPAID',
          paidAmount: 0,
          transactionId: null,
        },
      });
      if (claimed.count === 0) {
        throw new Error('این سفارش هم‌زمان توسط کاربر دیگری لغو شد.');
      }

      // Checked under the claim's row lock, so a return that committed before it is seen.
      if (await hasReturnsOrExchanges(tx, orderId)) {
        throw new Error(RETURNED_ORDER_MESSAGE);
      }

      // 2. Restore inventory. Never skip a line silently: resolve the target
      // warehouse through a validated fallback (the column is nullable and is
      // blanked when a warehouse is deleted), net out quantities already
      // credited back by returns/exchanges, and report anything intentionally
      // left uncredited instead of swallowing it.
      for (const item of order.items) {
        const note = await restoreOrderItemStock(
          tx,
          order as any,
          item as any,
          (item as any).product?.name ?? item.productId,
          order.number,
        );
        if (note) notRestored.push(note);
      }

      // 3. Delete every money row of the order (the checkout, later payments,
      // settlements) and undo exactly what each did to its account's balance,
      // in the account's own currency. Read after the claim: a payment either
      // committed before it or waits on the order lock and then sees CANCELLED.
      const moneyRows = await orderMoneyRows(tx, orderId, order.transactionId);
      // The operator confirmed the rows the preview showed: a payment booked
      // since then is not deleted behind their back.
      if (expectedMoneyRowIds && !sameIds(expectedMoneyRowIds, moneyRows.map((row) => row.id))) {
        throw new Error(PREVIEW_CHANGED_MESSAGE);
      }
      // order was read before the claim zeroed paidAmount: a payment that slipped in between makes
      // the sums disagree, which refuses the cancel (the safe side).
      const blocked = cancelBlocker(moneyRows, order, isAdmin);
      if (blocked) throw new Error(blocked);
      const deleted = await tx.transaction.deleteMany({ where: { id: { in: moneyRows.map((row) => row.id) } } });
      if (deleted.count !== moneyRows.length) {
        throw new Error('پرداخت‌های این سفارش هم‌زمان تغییر کرد؛ دوباره تلاش کنید.');
      }
      for (const row of moneyRows) {
        // balanceEffect is linear in the amount, so its value for 1 is the
        // row's direction; the stored amount is then taken back exactly.
        const direction = balanceEffect({ ...row, amount: 1 });
        if (!movesBalance(row) || !row.accountId || direction === 0) continue;
        await tx.account.update({
          where: { id: row.accountId },
          data: { balance: direction > 0 ? { decrement: row.amount } : { increment: row.amount } },
        });
      }

      // 4. Cancel the linked invoice (if any)
      if (order.invoice) {
        await tx.invoice.update({
          where: { id: order.invoice.id },
          data: { status: 'CANCELLED' },
        });
      }

      // 5. Mark order items as CANCELLED
      await tx.orderItem.updateMany({
        where: { orderId },
        data: { status: 'CANCELLED' },
      });
    });
    kickSiteHook();

    // Revalidate relevant paths to update the UI
    revalidatePath('/dashboard/sales/history');
    revalidatePath('/dashboard/sales');
    revalidatePath('/dashboard/reports/ar-aging');

    return {
      success: true,
      message: notRestored.length > 0
        ? `سفارش #${order.number} لغو شد، اما موجودی این اقلام بازنگشت: ${notRestored.join(' ')}`
        : `سفارش #${order.number} با موفقیت لغو شد و موجودی کالاها به انبار بازگشت.`,
    };
  } catch (error) {
    console.error('Error cancelling order:', error);
    // Surface the real reason (e.g. target warehouse could not be determined)
    // so the operator can fix it, instead of a blanket failure message.
    return {
      success: false,
      message: error instanceof Error ? error.message : 'خطا در لغو سفارش.',
    };
  }
}
