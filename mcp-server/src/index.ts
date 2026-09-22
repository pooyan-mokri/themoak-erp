#!/usr/bin/env node
/**
 * TheMoak ERP — MCP Server
 * Connects Claude Desktop (and any MCP-compatible client) to the ERP system.
 *
 * Config (env vars):
 *   ERP_API_URL    — e.g. https://themoak-erp.vercel.app
 *   ERP_API_SECRET — Bearer token: the ERP's full key, the same value as
 *                    ERP_API_SECRET in Vercel. Not ERP_SITE_API_SECRET: that is
 *                    the website's key, and every tool here would get 403 with it.
 */

import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const BASE_URL = (process.env.ERP_API_URL ?? '').replace(/\/$/, '');
const SECRET   = process.env.ERP_API_SECRET ?? '';

if (!BASE_URL || !SECRET) {
  process.stderr.write(
    'ERROR: ERP_API_URL and ERP_API_SECRET environment variables are required.\n',
  );
  process.exit(1);
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
async function erpGet(action: string, params: Record<string, string> = {}) {
  const url = new URL(`${BASE_URL}/api/erp`);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  if (!res.ok) throw new Error(`ERP API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function erpPost(body: Record<string, unknown>) {
  const res = await fetch(`${BASE_URL}/api/erp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SECRET}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ERP API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// Shared by the three tools that move money.
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

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'erp_summary',
    description:
      'Get a financial overview of the ERP: total balance across all accounts, last-30-day income/expense/profit, and number of pending settlements.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'erp_accounts',
    description:
      'List all bank accounts, cash registers, and wallets with their current balances, currencies, card numbers, and IBAN (sheba).',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'erp_transactions',
    description: 'Fetch recent financial transactions. Can filter by type (INCOME/EXPENSE/TRANSFER).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default 50, max 200)' },
        type:  { type: 'string', enum: ['INCOME', 'EXPENSE', 'TRANSFER'], description: 'Filter by transaction type' },
      },
    },
  },
  {
    name: 'erp_orders',
    description: 'Fetch recent sales orders with customer, items, status, and payment info.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max results (default 30, max 100)' },
      },
    },
  },
  {
    name: 'erp_settlements',
    description:
      'List pending consignment settlements — partners who have sold goods and owe us money.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'erp_loans',
    description: 'List employee loans with remaining balance and status.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'erp_search',
    description: 'Search across customers, products, transactions, and orders.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Search query (min 2 characters)' },
      },
      required: ['q'],
    },
  },
  {
    name: 'erp_inventory',
    description:
      "Stock for every saleable product across every warehouse — the owner's view, not the website feed. Per SKU: onHand (physical warehouses), consigned (امانی partner warehouses), available (the two added), net (what the ERP dashboards show, with negative rows subtracted), shortfall (the size of those negative rows), and a per-warehouse breakdown. Use filter=zero for nothing left anywhere, filter=low with `low` for what is running out, filter=negative to find warehouses the ERP deducts sales from while holding no stock.",
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['all', 'low', 'zero', 'negative'], description: 'Default all' },
        low:    { type: 'number', description: 'Threshold for filter=low, counted on `available` (default 5)' },
        sku:    { type: 'string', description: 'Only SKUs containing this text, e.g. PANJ' },
        includeArchived: { type: 'boolean', description: 'Include archived warehouses (default false)' },
      },
    },
  },
  {
    name: 'erp_product_sales',
    description:
      'Units sold per product over a recent window (cancelled orders excluded), next to what is left in stock. Returns sold, available, perMonth, and monthsLeft — the months of cover at the recent rate, null when nothing sold. This is the reorder list: sort by monthsLeft ascending. Pair it with erp_inventory before placing a supplier order.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Window in days (default 90, max 730)' },
      },
    },
  },
  {
    name: 'erp_deposit',
    description:
      'Record a deposit (income) into an account. Use this when money arrives into a company account. Returns the new row id, the booked amount and the account balance after it.',
    inputSchema: {
      type: 'object',
      properties: {
        accountId:   { type: 'string', description: 'Target account ID (get IDs from erp_accounts)' },
        amount:      { type: 'number', description: 'Amount in `currency`, greater than 0' },
        currency:    CURRENCY,
        description: { type: 'string', description: 'What is this deposit for? (بابت چی)' },
        category:    { type: 'string', description: 'Optional category' },
        date:        DATE,
        requestId:   REQUEST_ID,
      },
      required: ['accountId', 'amount', 'currency', 'description'],
    },
  },
  {
    name: 'erp_expense',
    description:
      'Record an expense or payment from an account. Use this when money leaves a company account. Returns the new row id, the booked amount and the account balance after it.',
    inputSchema: {
      type: 'object',
      properties: {
        accountId:   { type: 'string', description: 'Source account ID' },
        amount:      { type: 'number', description: 'Amount in `currency`, greater than 0' },
        currency:    CURRENCY,
        description: { type: 'string' },
        category:    { type: 'string' },
        payee:       { type: 'string', description: 'Who received the payment' },
        date:        DATE,
        requestId:   REQUEST_ID,
      },
      required: ['accountId', 'amount', 'currency', 'description'],
    },
  },
  {
    name: 'erp_transfer',
    description:
      'Transfer money between two company accounts. Both accounts must use the same currency. Returns both row ids, the amount and both balances after it.',
    inputSchema: {
      type: 'object',
      properties: {
        fromAccountId: { type: 'string', description: 'Source account ID' },
        toAccountId:   { type: 'string', description: 'Destination account ID' },
        amount:        { type: 'number', description: 'Amount in `currency`, greater than 0' },
        currency:      { ...CURRENCY, description: 'Currency of both accounts and of `amount`; refused if it is not theirs.' },
        description:   { type: 'string' },
        date:          DATE,
        requestId:     REQUEST_ID,
      },
      required: ['fromAccountId', 'toAccountId', 'amount', 'currency'],
    },
  },
];

// ── Server setup ──────────────────────────────────────────────────────────────
const server = new Server(
  { name: 'themoak-erp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

const MONEY_ACTIONS: Record<string, string> = { erp_deposit: 'deposit', erp_expense: 'expense', erp_transfer: 'transfer' };

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  // One id per call that moves money, so a call that reaches the ERP twice books once;
  // a retry passes the id back to be booked once too.
  const requestId = name in MONEY_ACTIONS ? (typeof args.requestId === 'string' && args.requestId) || randomUUID() : null;

  try {
    let result: unknown;

    switch (name) {
      case 'erp_summary':
        result = await erpGet('summary');
        break;
      case 'erp_accounts':
        result = await erpGet('accounts');
        break;
      case 'erp_transactions':
        result = await erpGet('transactions', {
          ...(args.limit ? { limit: String(args.limit) } : {}),
          ...(args.type  ? { type:  String(args.type)  } : {}),
        });
        break;
      case 'erp_orders':
        result = await erpGet('orders', args.limit ? { limit: String(args.limit) } : {});
        break;
      case 'erp_settlements':
        result = await erpGet('settlements');
        break;
      case 'erp_loans':
        result = await erpGet('loans');
        break;
      case 'erp_search':
        result = await erpGet('search', { q: String(args.q) });
        break;
      case 'erp_inventory':
        result = await erpGet('inventory', {
          ...(args.filter ? { filter: String(args.filter) } : {}),
          ...(args.low != null ? { low: String(args.low) } : {}),
          ...(args.sku ? { sku: String(args.sku) } : {}),
          ...(args.includeArchived ? { includeArchived: 'true' } : {}),
        });
        break;
      case 'erp_product_sales':
        result = await erpGet('productSales', args.days ? { days: String(args.days) } : {});
        break;
      case 'erp_deposit':
      case 'erp_expense':
      case 'erp_transfer':
        if (typeof args.currency !== 'string' || !args.currency) {
          throw new Error("currency is required: look up the account's currency with erp_accounts and pass it.");
        }
        result = await erpPost({ action: MONEY_ACTIONS[name], ...args, currency: args.currency, requestId });
        break;
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err: any) {
    // Whether the entry was booked is unknown after a network error: say how to retry safely.
    const retry = requestId
      ? `\nrequestId: ${requestId} — check erp_transactions, or call again with this requestId; it is booked only once.`
      : '';
    return {
      content: [{ type: 'text', text: `Error: ${err.message}${retry}` }],
      isError: true,
    };
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('TheMoak ERP MCP server running (stdio)\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
