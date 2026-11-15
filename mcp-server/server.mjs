#!/usr/bin/env node
/**
 * TheMoak ERP — the connector (MCP server) for Claude Desktop, on macOS and Windows.
 *
 * One file, no dependencies: Node 18+ and nothing else. It speaks MCP over stdio (JSON-RPC 2.0, one message a
 * line) and calls the ERP's API (/api/erp, docs/erp-api.md) with the key it is given.
 *
 *   ERP_API_URL  the ERP's address, e.g. https://erp.themoak.com
 *   ERP_API_KEY  a user's personal key (ERP → تنظیمات → کاربران → کلیدهای Claude), or the owner's full key.
 *                ERP_API_SECRET is read too, the name older installs used.
 *
 * The ERP serves this file as an installable bundle from the same dialog (src/lib/connector-bundle.ts), with
 * src/lib/connector-server.generated.ts as its copy of this text: after changing this file run
 * `node mcp-server/embed.mjs`. A test fails while the two differ.
 *
 * Every tool is one action of the API. A key sees only the tools it may use: the ERP says which actions a
 * personal key's role allows (action=whoami), and the owner's full key has every action but the five that are
 * done in a user's name.
 */
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

const VERSION = '2.0.0';

const BASE = (process.env.ERP_API_URL ?? '').trim().replace(/\/+$/, '');
const KEY = (process.env.ERP_API_KEY || process.env.ERP_API_SECRET || '').trim();

// ── The ERP's API ─────────────────────────────────────────────────────────────
async function erp(method, action, fields = {}) {
  if (!BASE || !KEY) throw new Error('کانکتور تنظیم نشده است: آدرس ERP و کلید را در تنظیمات کانکتور وارد کنید.');
  const url = new URL(BASE + '/api/erp');
  const init = { method, headers: { Authorization: 'Bearer ' + KEY } };
  if (method === 'GET') {
    url.searchParams.set('action', action);
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  } else {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify({ action, ...fields });
  }
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      message = JSON.stringify(JSON.parse(text));
    } catch {
      // Not JSON: the text as it came.
    }
    const hint =
      res.status === 401 ? ' — کلید درست نیست یا باطل شده است.' : res.status === 403 ? ' — این کلید اجازهٔ این کار را ندارد.' : '';
    throw new Error('ERP ' + res.status + hint + ' ' + message);
  }
  return JSON.parse(text);
}

// ── Tools ─────────────────────────────────────────────────────────────────────
const CURRENCY = {
  type: 'string',
  enum: ['TOMAN', 'USD', 'EUR', 'CNY'],
  description: "Currency of `amount`. Always pass it: check the account's currency in erp_accounts first.",
};
const DATE = {
  type: 'string',
  description: 'Gregorian date YYYY-MM-DD, e.g. 2026-09-21 (defaults to today). Never a Jalali date like 1405-06-30: it is refused.',
};
const REQUEST_ID = {
  type: 'string',
  description:
    'Leave empty for a new entry. When retrying an entry whose result you did not see, pass the requestId from the earlier error: the ERP then books it only once. Must be 8-64 letters, digits, - or _.',
};
const CONFIRM = ' پیش از ثبت، خلاصه را برای کاربر بخوانید و تأییدش را بگیرید؛ بدون تأیید ثبت نکنید.';
const none = { type: 'object', properties: {} };
/** Only the arguments that were given, as strings, for a GET. */
const picked = (args, names) => Object.fromEntries(names.filter((k) => args[k] != null && args[k] !== '').map((k) => [k, String(args[k])]));

/**
 * name, the API action it runs, how (GET/POST), and whether a call gets a requestId of its own, so one that
 * reaches the ERP twice is booked once. `args` shapes the arguments when they are not sent as they are.
 */
const TOOLS = [
  {
    name: 'erp_whoami',
    action: 'whoami',
    method: 'GET',
    description: 'این کلید مال کیست: نام، نقش، دسترسی‌ها و کارهایی که با آن می‌شود کرد. اگر ابزاری ۴۰۳ داد، با این ببینید نقش کاربر چه اجازه‌هایی دارد.',
    inputSchema: none,
  },
  {
    name: 'erp_summary',
    action: 'summary',
    method: 'GET',
    description:
      'Get a financial overview of the ERP: total balance across all accounts, last-30-day income/expense/profit, and number of pending settlements.',
    inputSchema: none,
  },
  {
    name: 'erp_accounts',
    action: 'accounts',
    method: 'GET',
    description: 'List all bank accounts, cash registers, and wallets with their current balances, currencies, card numbers, and IBAN (sheba).',
    inputSchema: none,
  },
  {
    name: 'erp_transactions',
    action: 'transactions',
    method: 'GET',
    description: 'Fetch recent financial transactions. Can filter by type (INCOME/EXPENSE/TRANSFER).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default 50, max 200)' },
        type: { type: 'string', enum: ['INCOME', 'EXPENSE', 'TRANSFER'], description: 'Filter by transaction type' },
      },
    },
    args: (a) => picked(a, ['limit', 'type']),
  },
  {
    name: 'erp_orders',
    action: 'orders',
    method: 'GET',
    description: 'Fetch recent sales orders with customer, items, status, and payment info.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max results (default 30, max 100)' } } },
    args: (a) => picked(a, ['limit']),
  },
  {
    name: 'erp_settlements',
    action: 'settlements',
    method: 'GET',
    description: 'List pending consignment settlements — partners who have sold goods and owe us money.',
    inputSchema: none,
  },
  {
    name: 'erp_loans',
    action: 'loans',
    method: 'GET',
    description: 'List employee loans with remaining balance and status.',
    inputSchema: none,
  },
  {
    name: 'erp_search',
    action: 'search',
    method: 'GET',
    description: 'Search across customers, products, transactions, and orders.',
    inputSchema: { type: 'object', properties: { q: { type: 'string', description: 'Search query (min 2 characters)' } }, required: ['q'] },
    args: (a) => ({ q: String(a.q ?? '') }),
  },
  {
    name: 'erp_warehouses',
    action: 'warehouses',
    method: 'GET',
    description: 'انبارهای فعال (شناسه و نام)؛ برای ثبت سفارش فروش و انتقال کالا نام انبار را از این‌جا بردارید.',
    inputSchema: none,
  },
  {
    name: 'erp_inventory',
    action: 'inventory',
    method: 'GET',
    description:
      "Stock for every saleable product across every warehouse — the owner's view, not the website feed. Per SKU: onHand (physical warehouses), consigned (امانی partner warehouses), available (the two added), net (what the ERP dashboards show, with negative rows subtracted), shortfall (the size of those negative rows), and a per-warehouse breakdown. Use filter=zero for nothing left anywhere, filter=low with `low` for what is running out, filter=negative to find warehouses the ERP deducts sales from while holding no stock.",
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['all', 'low', 'zero', 'negative'], description: 'Default all' },
        low: { type: 'number', description: 'Threshold for filter=low, counted on `available` (default 5)' },
        sku: { type: 'string', description: 'Only SKUs containing this text, e.g. PANJ' },
        includeArchived: { type: 'boolean', description: 'Include archived warehouses (default false)' },
      },
    },
    args: (a) => ({ ...picked(a, ['filter', 'low', 'sku']), ...(a.includeArchived ? { includeArchived: 'true' } : {}) }),
  },
  {
    name: 'erp_product_sales',
    action: 'productSales',
    method: 'GET',
    description:
      'Units sold per product over a recent window (cancelled orders excluded), next to what is left in stock. Returns sold, available, perMonth, and monthsLeft — the months of cover at the recent rate, null when nothing sold. This is the reorder list: sort by monthsLeft ascending. Pair it with erp_inventory before placing a supplier order.',
    inputSchema: { type: 'object', properties: { days: { type: 'number', description: 'Window in days (default 90, max 730)' } } },
    args: (a) => picked(a, ['days']),
  },
  {
    name: 'erp_deposit',
    action: 'deposit',
    method: 'POST',
    requestId: true,
    needsCurrency: true,
    description:
      'Record a deposit (income) into an account. Use this when money arrives into a company account. Returns the new row id, the booked amount and the account balance after it.',
    inputSchema: {
      type: 'object',
      properties: {
        accountId: { type: 'string', description: 'Target account ID (get IDs from erp_accounts)' },
        amount: { type: 'number', description: 'Amount in `currency`, greater than 0' },
        currency: CURRENCY,
        description: { type: 'string', description: 'What is this deposit for? (بابت چی)' },
        category: { type: 'string', description: 'Optional category' },
        date: DATE,
        requestId: REQUEST_ID,
      },
      required: ['accountId', 'amount', 'currency', 'description'],
    },
  },
  {
    name: 'erp_expense',
    action: 'expense',
    method: 'POST',
    requestId: true,
    needsCurrency: true,
    description:
      'Record an expense or payment from an account. Use this when money leaves a company account. Returns the new row id, the booked amount and the account balance after it.',
    inputSchema: {
      type: 'object',
      properties: {
        accountId: { type: 'string', description: 'Source account ID' },
        amount: { type: 'number', description: 'Amount in `currency`, greater than 0' },
        currency: CURRENCY,
        description: { type: 'string' },
        category: { type: 'string' },
        payee: { type: 'string', description: 'Who received the payment' },
        date: DATE,
        requestId: REQUEST_ID,
      },
      required: ['accountId', 'amount', 'currency', 'description'],
    },
  },
  {
    name: 'erp_transfer',
    action: 'transfer',
    method: 'POST',
    requestId: true,
    needsCurrency: true,
    description:
      'Transfer money between two company accounts. Both accounts must use the same currency. Returns both row ids, the amount and both balances after it.',
    inputSchema: {
      type: 'object',
      properties: {
        fromAccountId: { type: 'string', description: 'Source account ID' },
        toAccountId: { type: 'string', description: 'Destination account ID' },
        amount: { type: 'number', description: 'Amount in `currency`, greater than 0' },
        currency: { ...CURRENCY, description: 'Currency of both accounts and of `amount`; refused if it is not theirs.' },
        description: { type: 'string' },
        date: DATE,
        requestId: REQUEST_ID,
      },
      required: ['fromAccountId', 'toAccountId', 'amount', 'currency'],
    },
  },

  // ── فروش: به نام کاربرِ کلید (فقط کلید شخصی) ────────────────────────────────
  {
    name: 'erp_create_customer',
    action: 'createCustomer',
    method: 'POST',
    description: 'ثبت مشتری تازه. اول با erp_search ببینید از قبل نباشد.' + CONFIRM,
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, phone: { type: 'string', description: 'شماره موبایل' }, email: { type: 'string' }, address: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'erp_create_order',
    action: 'createOrder',
    method: 'POST',
    requestId: true,
    description:
      'ثبت «سفارش فروش» برای مشتری، به تومان: اقلام با SKU، حسابی که پول به آن می‌آید و انباری که کالا از آن می‌رود. مشتری را با شماره موبایل یا نام یا شناسه بدهید؛ بدون مشتری، فروش حضوری ثبت می‌شود. قیمت هر قلم اگر داده نشود قیمت فروش کالاست. paidAmount مبلغی است که همین حالا پرداخت شده (پیش‌فرض: کل مبلغ).' +
      CONFIRM,
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string' },
              quantity: { type: 'number', description: 'پیش‌فرض ۱' },
              price: { type: 'number', description: 'قیمت واحد به تومان؛ خالی = قیمت فروش کالا' },
            },
            required: ['sku'],
          },
        },
        customerPhone: { type: 'string', description: 'شماره موبایل مشتری' },
        customerName: { type: 'string' },
        customerId: { type: 'string' },
        account: { type: 'string', description: 'نام یا شناسهٔ حساب دریافت پول (از erp_accounts)' },
        warehouse: { type: 'string', description: 'نام یا شناسهٔ انبار؛ خالی = انبار اصلی' },
        discount: { type: 'number', description: 'تخفیف کل سفارش به تومان' },
        paidAmount: { type: 'number', description: 'مبلغ پرداخت‌شده به تومان' },
        date: DATE,
        requestId: REQUEST_ID,
      },
      required: ['items', 'account'],
    },
  },
  {
    name: 'erp_record_payment',
    action: 'recordOrderPayment',
    method: 'POST',
    requestId: true,
    description:
      'ثبت پرداختِ مشتری برای یک «سفارش فروش»، به تومان، به حسابی که پول به آن آمده. فقط برای سفارش فروش است؛ پرداخت به تأمین‌کننده برای سفارش خرید با erp_pay_purchase_order ثبت می‌شود.' +
      CONFIRM,
    inputSchema: {
      type: 'object',
      properties: {
        orderNumber: { type: 'number', description: 'شمارهٔ سفارش فروش' },
        account: { type: 'string', description: 'نام یا شناسهٔ حسابی که پول به آن آمده' },
        amount: { type: 'number', description: 'مبلغ به تومان' },
        requestId: REQUEST_ID,
      },
      required: ['orderNumber', 'account', 'amount'],
    },
  },
  {
    name: 'erp_return_order_item',
    action: 'returnOrderItem',
    method: 'POST',
    requestId: true,
    description:
      'ثبت مرجوعیِ یک قلم از «سفارش فروش»: کالا به انبار برمی‌گردد و پول از حسابی که می‌گویید به مشتری برمی‌گردد. اگر سفارش چند قلم دارد SKU لازم است.' + CONFIRM,
    inputSchema: {
      type: 'object',
      properties: {
        orderNumber: { type: 'number', description: 'شمارهٔ سفارش فروش' },
        sku: { type: 'string', description: 'کد کالای مرجوعی' },
        quantity: { type: 'number', description: 'پیش‌فرض ۱' },
        account: { type: 'string', description: 'نام یا شناسهٔ حسابی که پول از آن برمی‌گردد' },
        warehouse: { type: 'string', description: 'انباری که کالا به آن برمی‌گردد؛ خالی = همان انبار فروش' },
        reason: { type: 'string' },
        requestId: REQUEST_ID,
      },
      required: ['orderNumber', 'account'],
    },
  },
  {
    name: 'erp_transfer_stock',
    action: 'transferStock',
    method: 'POST',
    description: 'انتقال کالا بین دو انبار. نام انبارها را از erp_warehouses یا erp_inventory بردارید.' + CONFIRM,
    inputSchema: {
      type: 'object',
      properties: {
        sku: { type: 'string' },
        from: { type: 'string', description: 'نام یا شناسهٔ انبار مبدأ' },
        to: { type: 'string', description: 'نام یا شناسهٔ انبار مقصد' },
        quantity: { type: 'number' },
        note: { type: 'string' },
      },
      required: ['sku', 'from', 'to', 'quantity'],
    },
  },

  // ── خرید ─────────────────────────────────────────────────────────────────────
  {
    name: 'erp_suppliers',
    action: 'suppliers',
    method: 'GET',
    description: 'Suppliers: id, name, phone, email and how many purchase orders each has.',
    inputSchema: none,
  },
  {
    name: 'erp_purchase_orders',
    action: 'purchaseOrders',
    method: 'GET',
    description:
      "Recent purchase orders: number, supplier, status, tags (a PI: tag names the supplier's proforma invoice), currency, totalAmount in that currency, totalAmountInToman (null until paid), items (sku, name, quantity, unitCost, currency, receivedQuantity), additional costs, payments (each with its Toman value and, when it was recorded in the currency actually paid, paidAmount, paidCurrency, the account and its currency, accountAmount, accountRate and tomanRate), paidInOrderCurrency and remainingInOrderCurrency (the order's balance in its own currency), and unpaidInToman (an order without a Toman total is counted at today's rate).",
    inputSchema: {
      type: 'object',
      properties: {
        supplier: { type: 'string', description: "A supplier's id or part of its name" },
        status: { type: 'string', enum: ['DRAFT', 'PENDING_PAYMENT', 'PARTIALLY_PAID', 'PAID', 'IN_PRODUCTION', 'ARRIVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'] },
        tag: { type: 'string', description: 'Only orders with this tag, e.g. PI:2026-031' },
        limit: { type: 'number', description: 'Default 30, max 100' },
      },
    },
    args: (a) => picked(a, ['supplier', 'status', 'tag', 'limit']),
  },
  {
    name: 'erp_create_supplier',
    action: 'createSupplier',
    method: 'POST',
    description:
      'Add a supplier. A name already there (case aside) is refused and the existing one returned: check erp_suppliers first. Read the details back to the user and get their confirmation before creating.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, address: { type: 'string' } },
      required: ['name'],
    },
  },
  {
    name: 'erp_create_product',
    action: 'createProduct',
    method: 'POST',
    description:
      'Add a product, as the product form does (an in-store barcode is made). It does not go on the website: only a product given its site id on the product page is sold there. An SKU already taken (case aside) is refused. Read the details back to the user and get their confirmation before creating.',
    inputSchema: {
      type: 'object',
      properties: {
        sku: { type: 'string' },
        name: { type: 'string' },
        sellPrice: { type: 'number', description: 'Toman' },
        costPrice: { type: 'number', description: 'Toman, optional (default 0)' },
        productType: { type: 'string', enum: ['SALEABLE', 'FIXED_ASSET', 'CONSUMABLE', 'OTHER'], description: 'Default SALEABLE' },
      },
      required: ['sku', 'name', 'sellPrice'],
    },
  },
  {
    name: 'erp_create_purchase_order',
    action: 'createPurchaseOrder',
    method: 'POST',
    description:
      "Record a purchase order exactly as the supplier's PI states it: one currency for the whole order (usually CNY), prices in that currency, no Toman figure (its Toman value is the rate paid, at payment). Products by SKU; unknown SKUs are listed and nothing is written — add them with erp_create_product first. The same SKU may come twice (e.g. 17 paid + 3 free at unitCost 0). Put the PI number in tags as PI:<number>: a PI already on an order is refused. Before creating, read the whole order back to the user (supplier, each line, costs, total, currency, PI) and get their confirmation.",
    inputSchema: {
      type: 'object',
      properties: {
        supplier: { type: 'string', description: "The supplier's name or id" },
        currency: { ...CURRENCY, description: "The order's one currency (the PI's)" },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string' },
              quantity: { type: 'number', description: 'A whole number, 1 or more' },
              unitCost: { type: 'number', description: "In the order's currency; 0 for a free line" },
            },
            required: ['sku', 'quantity', 'unitCost'],
          },
        },
        additionalCosts: {
          type: 'array',
          description: "Freight, commission and the like, in the order's currency",
          items: { type: 'object', properties: { title: { type: 'string' }, amount: { type: 'number' } }, required: ['title', 'amount'] },
        },
        tags: { type: 'array', items: { type: 'string' }, description: 'e.g. ["PI:2026-031"]' },
        status: { type: 'string', enum: ['DRAFT', 'PENDING_PAYMENT'], description: 'Default DRAFT' },
      },
      required: ['supplier', 'currency', 'items'],
    },
  },
  {
    name: 'erp_pay_purchase_order',
    action: 'payPurchaseOrder',
    method: 'POST',
    requestId: true,
    description:
      'ثبت پرداخت یک «سفارش خرید» (پرداخت به تأمین‌کننده)، به همان ارزی که واقعاً پرداخت شده. فقط برای سفارش خرید است؛ پرداختِ سفارش فروشِ مشتری با erp_record_payment ثبت می‌شود. ' +
      'مبلغ و ارزِ پرداخت‌شده را بدهید (مثلاً ۲۰۰۰ یوان با وی‌چت یا علی‌پی) و حسابی که پول از آن رفته. اگر ارز پرداخت با ارز حساب فرق دارد، نرخ بانک (accountRate) لازم است: چند واحد از ارز پرداخت برای هر ۱ واحد ارز حساب (مثلاً ۶٫۶۷۰۳ یوان برای هر دلار)؛ اگر حساب تومانی است، چند تومان برای هر واحد ارز پرداخت. ' +
      'tomanRate نرخ تومانِ هر واحد ارز حساب است؛ اگر ندهید آخرین نرخ ثبت‌شده در ERP می‌آید. ' +
      'ERP از حساب به ارز خودش کم می‌کند، ارزش تومانی را حساب می‌کند و ماندهٔ سفارش را به ارز سفارش نگه می‌دارد؛ با صفر شدن مانده، سفارش «پرداخت شده» می‌شود و قیمت تومانی اقلامش با نرخ واقعیِ پرداخت ثبت می‌شود. ' +
      'پیش از ثبت، اول با erp_purchase_orders و erp_accounts سفارش و حساب را ببینید، بعد خلاصه را برای کاربر بخوانید (شمارهٔ سفارش، مبلغ، ارز، حساب، نرخ بانک، نرخ تومان، مبلغی که از حساب کم می‌شود و ارزش تومانی) و تأییدش را بگیرید. بدون تأیید ثبت نکنید.',
    inputSchema: {
      type: 'object',
      properties: {
        order: { type: 'number', description: 'شمارهٔ سفارش خرید، مثلاً 8 برای PO-8' },
        account: { type: 'string', description: 'نام یا شناسهٔ حسابی که پول از آن رفته (از erp_accounts)' },
        amount: { type: 'number', description: 'مبلغ پرداخت‌شده، به ارزِ currency' },
        currency: { ...CURRENCY, description: 'ارزی که واقعاً پرداخت شده، مثلاً CNY' },
        accountRate: {
          type: 'number',
          description: 'نرخ بانک، فقط وقتی ارز پرداخت با ارز حساب فرق دارد: واحدِ ارز پرداخت برای هر ۱ واحد ارز حساب (از حساب تومانی: تومان برای هر واحد ارز پرداخت)',
        },
        tomanRate: { type: 'number', description: 'تومان برای هر ۱ واحد ارز حساب؛ خالی = آخرین نرخ ثبت‌شده در ERP' },
        date: DATE,
        note: { type: 'string', description: 'توضیح کوتاه، مثلاً «بیعانه» یا «وی‌چت»' },
        requestId: REQUEST_ID,
      },
      required: ['order', 'account', 'amount', 'currency'],
    },
  },
  {
    name: 'erp_add_purchase_order_cost',
    action: 'addPurchaseOrderCost',
    method: 'POST',
    description:
      'افزودن یک هزینهٔ تازه به «سفارش خرید»، به ارز خودِ سفارش (مثلاً ۳۲۲ یوان بابت حک لوگو که تأمین‌کننده بعد از PI اضافه کرده). جمع سفارش به همان اندازه بالا می‌رود؛ سفارشی که «پرداخت شده» بود دوباره بدهکار می‌شود و به «پرداخت جزئی» برمی‌گردد. ' +
      'برای سفارشِ دریافت‌شده، نیمه‌دریافت‌شده یا لغوشده رد می‌شود، و همان عنوان و مبلغ دو بار ثبت نمی‌شود. ' +
      'پیش از ثبت، خلاصه را برای کاربر بخوانید (شمارهٔ سفارش، عنوان هزینه، مبلغ و ارز) و تأییدش را بگیرید. بدون تأیید ثبت نکنید.',
    inputSchema: {
      type: 'object',
      properties: {
        order: { type: 'number', description: 'شمارهٔ سفارش خرید، مثلاً 8 برای PO-8' },
        title: { type: 'string', description: 'عنوان هزینه، مثلاً Gold-filled laser logo' },
        amount: { type: 'number', description: 'مبلغ، به ارز سفارش' },
      },
      required: ['order', 'title', 'amount'],
    },
  },
];

/** Done in a user's name: a personal key only (src/lib/erp-api-personal.ts PERSONAL_POST_ACTIONS). */
const PERSONAL_ONLY = ['createCustomer', 'createOrder', 'recordOrderPayment', 'returnOrderItem', 'transferStock'];

/**
 * The actions this key may run, asked once: a personal key's role decides (whoami lists them), the owner's full
 * key runs all but the personal ones. Null when the ERP could not be asked: then every tool is offered, and the
 * ERP still refuses what the key may not do.
 */
let allowed;
async function allowedActions() {
  if (allowed !== undefined) return allowed;
  try {
    const me = await erp('GET', 'whoami');
    if (me.owner) allowed = TOOLS.map((t) => t.action).filter((a) => a !== 'whoami' && !PERSONAL_ONLY.includes(a));
    else if (Array.isArray(me.actions)) allowed = me.actions;
    else allowed = null;
  } catch {
    return null; // Not remembered: the next list asks again.
  }
  return allowed;
}

async function listTools() {
  const actions = await allowedActions();
  return TOOLS.filter((t) => !actions || actions.includes(t.action)).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

async function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { content: [{ type: 'text', text: 'Unknown tool: ' + name }], isError: true };
  const requestId = tool.requestId ? (typeof args.requestId === 'string' && args.requestId) || randomUUID() : null;
  try {
    if (tool.needsCurrency && (typeof args.currency !== 'string' || !args.currency)) {
      throw new Error("currency is required: look up the account's currency with erp_accounts and pass it.");
    }
    const fields = tool.args ? tool.args(args) : tool.method === 'GET' ? {} : { ...args, ...(requestId && { requestId }) };
    const result = await erp(tool.method, tool.action, fields);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    // Whether the entry was booked is unknown after a network error: say how to retry safely.
    const retry = requestId ? '\nrequestId: ' + requestId + ' — برای تکرار همین ثبت، همین requestId را بفرستید تا فقط یک بار ثبت شود.' : '';
    return { content: [{ type: 'text', text: 'Error: ' + (error?.message ?? String(error)) + retry }], isError: true };
  }
}

// ── MCP over stdio: JSON-RPC 2.0, one message a line ─────────────────────────
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');

async function handle(message) {
  const { id, method, params } = message;
  const reply = (result) => id !== undefined && id !== null && send({ jsonrpc: '2.0', id, result });
  try {
    switch (method) {
      case 'initialize':
        return reply({
          protocolVersion: params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'themoak-erp', version: VERSION },
        });
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: await listTools() });
      case 'tools/call':
        return reply(await callTool(params?.name, params?.arguments ?? {}));
      default:
        // A notification (no id) needs no answer.
        if (id !== undefined && id !== null) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
    }
  } catch (error) {
    if (id !== undefined && id !== null) send({ jsonrpc: '2.0', id, error: { code: -32000, message: error?.message ?? String(error) } });
  }
}

const lines = createInterface({ input: process.stdin, terminal: false });
lines.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  void handle(message);
});
lines.on('close', () => process.exit(0));
process.stderr.write('TheMoak ERP connector ' + VERSION + ' running (stdio)' + (BASE && KEY ? '' : ' — ERP_API_URL or ERP_API_KEY is missing') + '\n');
