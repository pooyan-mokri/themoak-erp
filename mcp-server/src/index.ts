#!/usr/bin/env node
/**
 * TheMoak ERP — MCP Server
 * Connects Claude Desktop (and any MCP-compatible client) to the ERP system.
 *
 * Config (env vars):
 *   ERP_API_URL    — e.g. https://themoak-erp.vercel.app
 *   ERP_API_SECRET — Bearer token (same value set in Vercel)
 */

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
    name: 'erp_deposit',
    description:
      'Record a deposit (income) into an account. Use this when money arrives into a company account.',
    inputSchema: {
      type: 'object',
      properties: {
        accountId:   { type: 'string', description: 'Target account ID (get IDs from erp_accounts)' },
        amount:      { type: 'number', description: 'Amount in the specified currency' },
        currency:    { type: 'string', enum: ['TOMAN', 'USD', 'EUR', 'CNY'], default: 'TOMAN' },
        description: { type: 'string', description: 'What is this deposit for? (بابت چی)' },
        category:    { type: 'string', description: 'Optional category' },
        date:        { type: 'string', description: 'Date YYYY-MM-DD (defaults to today)' },
      },
      required: ['accountId', 'amount', 'description'],
    },
  },
  {
    name: 'erp_expense',
    description:
      'Record an expense or payment from an account. Use this when money leaves a company account.',
    inputSchema: {
      type: 'object',
      properties: {
        accountId:   { type: 'string', description: 'Source account ID' },
        amount:      { type: 'number' },
        currency:    { type: 'string', enum: ['TOMAN', 'USD', 'EUR', 'CNY'], default: 'TOMAN' },
        description: { type: 'string' },
        category:    { type: 'string' },
        payee:       { type: 'string', description: 'Who received the payment' },
        date:        { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['accountId', 'amount', 'description'],
    },
  },
  {
    name: 'erp_transfer',
    description:
      'Transfer money between two company accounts. Both accounts must use the same currency.',
    inputSchema: {
      type: 'object',
      properties: {
        fromAccountId: { type: 'string', description: 'Source account ID' },
        toAccountId:   { type: 'string', description: 'Destination account ID' },
        amount:        { type: 'number' },
        description:   { type: 'string' },
        date:          { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['fromAccountId', 'toAccountId', 'amount'],
    },
  },
];

// ── Server setup ──────────────────────────────────────────────────────────────
const server = new Server(
  { name: 'themoak-erp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

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
      case 'erp_deposit':
        result = await erpPost({ action: 'deposit', ...args });
        break;
      case 'erp_expense':
        result = await erpPost({ action: 'expense', ...args });
        break;
      case 'erp_transfer':
        result = await erpPost({ action: 'transfer', ...args });
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
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
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
