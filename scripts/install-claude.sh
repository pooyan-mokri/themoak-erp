#!/usr/bin/env bash
# TheMoak ERP — Claude Desktop Installer
# bash <(curl -fsSL https://raw.githubusercontent.com/pooyan-mokri/themoak-erp/main/scripts/install-claude.sh)
set -e

INSTALL_DIR="$HOME/.themoak-erp-mcp"
DEFAULT_URL="https://themoak-erp.vercel.app"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()  { echo -e "${GREEN}✓${NC} $*"; }
err() { echo -e "${RED}✗${NC} $*"; exit 1; }
ask() { echo -e "${YELLOW}?${NC}  $*"; }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   TheMoak ERP → Claude Desktop Installer"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Check Node.js ─────────────────────────────────────────────────────────────
command -v node &>/dev/null || err "Node.js پیدا نشد — از https://nodejs.org نصب کن (v18+)"
NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
[ "$NODE_MAJOR" -ge 18 ] || err "Node.js v18+ لازمه (الان: v$(node -v))"
ok "Node.js $(node -v)"

command -v npm &>/dev/null || err "npm پیدا نشد"
ok "npm v$(npm -v)"

# ── Get config ────────────────────────────────────────────────────────────────
echo ""
ask "آدرس ERP [Enter برای پیش‌فرض: $DEFAULT_URL]:"
read -r ERP_URL
ERP_URL="${ERP_URL:-$DEFAULT_URL}"
ERP_URL="${ERP_URL%/}"   # remove trailing slash

echo ""
ask "ERP_API_SECRET (کلید Vercel):"
read -rs ERP_SECRET
echo ""
[ -n "$ERP_SECRET" ] || err "Secret نمی‌تونه خالی باشه"

# ── Write files ───────────────────────────────────────────────────────────────
echo ""
echo "📦 نصب در $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"

# package.json — plain ESM, no build step needed
cat > "$INSTALL_DIR/package.json" << 'EOF'
{
  "name": "themoak-erp-mcp",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  }
}
EOF

# server.mjs — plain JavaScript, runs directly with node
cat > "$INSTALL_DIR/server.mjs" << 'EOF'
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const BASE   = (process.env.ERP_API_URL   ?? '').replace(/\/$/, '');
const SECRET = (process.env.ERP_API_SECRET ?? '');

if (!BASE || !SECRET) {
  process.stderr.write('ERROR: ERP_API_URL and ERP_API_SECRET are required\n');
  process.exit(1);
}

const H = { Authorization: `Bearer ${SECRET}` };

async function erpGet(action, params = {}) {
  const url = new URL(`${BASE}/api/erp`);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: H });
  if (!res.ok) throw new Error(`ERP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function erpPost(body) {
  const res = await fetch(`${BASE}/api/erp`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ERP ${res.status}: ${await res.text()}`);
  return res.json();
}

const TOOLS = [
  { name: 'erp_summary',      description: 'خلاصه مالی: موجودی کل، درآمد/هزینه ۳۰ روز، تعداد تسویه‌های در انتظار', inputSchema: { type: 'object', properties: {} } },
  { name: 'erp_accounts',     description: 'لیست حساب‌ها با موجودی، شماره کارت و شبا', inputSchema: { type: 'object', properties: {} } },
  { name: 'erp_transactions', description: 'تراکنش‌های اخیر (فیلتر بر نوع)', inputSchema: { type: 'object', properties: {
    limit: { type: 'number', description: 'تعداد (پیش‌فرض ۵۰)' },
    type:  { type: 'string', enum: ['INCOME','EXPENSE','TRANSFER'] },
  }}},
  { name: 'erp_orders',       description: 'سفارش‌های فروش اخیر', inputSchema: { type: 'object', properties: {
    limit: { type: 'number', description: 'تعداد (پیش‌فرض ۳۰)' },
  }}},
  { name: 'erp_settlements',  description: 'تسویه‌های امانت در انتظار پرداخت', inputSchema: { type: 'object', properties: {} } },
  { name: 'erp_loans',        description: 'قرض‌های کارمندان', inputSchema: { type: 'object', properties: {} } },
  { name: 'erp_search',       description: 'جستجو در مشتریان، محصولات، تراکنش‌ها و سفارش‌ها', inputSchema: { type: 'object', properties: {
    q: { type: 'string' },
  }, required: ['q'] }},
  { name: 'erp_deposit',      description: 'ثبت واریز پول به یک حساب', inputSchema: { type: 'object', properties: {
    accountId:   { type: 'string' },
    amount:      { type: 'number' },
    currency:    { type: 'string', enum: ['TOMAN','USD','EUR','CNY'], default: 'TOMAN' },
    description: { type: 'string' },
    category:    { type: 'string' },
    date:        { type: 'string', description: 'YYYY-MM-DD' },
  }, required: ['accountId','amount','description'] }},
  { name: 'erp_expense',      description: 'ثبت هزینه یا پرداخت از یک حساب', inputSchema: { type: 'object', properties: {
    accountId:   { type: 'string' },
    amount:      { type: 'number' },
    currency:    { type: 'string', enum: ['TOMAN','USD','EUR','CNY'], default: 'TOMAN' },
    description: { type: 'string' },
    category:    { type: 'string' },
    payee:       { type: 'string', description: 'دریافت‌کننده' },
    date:        { type: 'string' },
  }, required: ['accountId','amount','description'] }},
  { name: 'erp_transfer',     description: 'انتقال وجه بین دو حساب هم‌ارز', inputSchema: { type: 'object', properties: {
    fromAccountId: { type: 'string' },
    toAccountId:   { type: 'string' },
    amount:        { type: 'number' },
    description:   { type: 'string' },
    date:          { type: 'string' },
  }, required: ['fromAccountId','toAccountId','amount'] }},
];

const server = new Server(
  { name: 'themoak-erp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: a = {} } = req.params;
  try {
    let result;
    switch (name) {
      case 'erp_summary':      result = await erpGet('summary'); break;
      case 'erp_accounts':     result = await erpGet('accounts'); break;
      case 'erp_transactions': result = await erpGet('transactions', { ...(a.limit && { limit: a.limit }), ...(a.type && { type: a.type }) }); break;
      case 'erp_orders':       result = await erpGet('orders', a.limit ? { limit: a.limit } : {}); break;
      case 'erp_settlements':  result = await erpGet('settlements'); break;
      case 'erp_loans':        result = await erpGet('loans'); break;
      case 'erp_search':       result = await erpGet('search', { q: a.q }); break;
      case 'erp_deposit':      result = await erpPost({ action: 'deposit',  ...a }); break;
      case 'erp_expense':      result = await erpPost({ action: 'expense',  ...a }); break;
      case 'erp_transfer':     result = await erpPost({ action: 'transfer', ...a }); break;
      default: return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
process.stderr.write('TheMoak ERP MCP server running\n');
EOF

# ── npm install ───────────────────────────────────────────────────────────────
cd "$INSTALL_DIR"
echo "   npm install (ممکنه چند ثانیه طول بکشه)..."
NODE_NO_WARNINGS=1 npm install --silent 2>/dev/null
ok "MCP server آماده: $INSTALL_DIR/server.mjs"

# ── Write Claude Desktop config ───────────────────────────────────────────────
echo ""
echo "⚙️  تنظیم Claude Desktop..."

if [[ "$OSTYPE" == "darwin"* ]]; then
  CONFIG_DIR="$HOME/Library/Application Support/Claude"
else
  CONFIG_DIR="${APPDATA:-$HOME/.config}/Claude"
fi
CONFIG_FILE="$CONFIG_DIR/claude_desktop_config.json"
mkdir -p "$CONFIG_DIR"

[ -f "$CONFIG_FILE" ] && cp "$CONFIG_FILE" "$CONFIG_FILE.bak" && ok "پشتیبان: $CONFIG_FILE.bak"

node -e "
const fs = require('fs');
const f = '$CONFIG_FILE';
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(f, 'utf8')); } catch(e) {}
cfg.mcpServers = cfg.mcpServers || {};
cfg.mcpServers['themoak-erp'] = {
  command: 'node',
  args: ['$INSTALL_DIR/server.mjs'],
  env: { ERP_API_URL: '$ERP_URL', ERP_API_SECRET: '$ERP_SECRET' }
};
fs.writeFileSync(f, JSON.stringify(cfg, null, 2));
"
ok "Claude Desktop config آپدیت شد"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}  آماده‌ست! ✓${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  ۱. Claude Desktop رو ببند و دوباره باز کن"
echo "  ۲. آیکون 🔧 رو کنار input ببین"
echo "  ۳. امتحان کن:"
echo '     "موجودی همه حساب‌هام رو نشون بده"'
echo '     "گزارش مالی ۳۰ روز گذشته"'
echo '     "تسویه‌های در انتظار پرداخت"'
echo ""
echo "  Config: $CONFIG_FILE"
echo "  Server: $INSTALL_DIR/server.mjs"
echo ""
