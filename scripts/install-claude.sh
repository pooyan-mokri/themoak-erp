#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# TheMoak ERP — Claude Desktop Installer (self-contained, no internet needed)
# Run from your local repo:  bash scripts/install-claude.sh
# ─────────────────────────────────────────────────────────────────────────────
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

# ── 1. Check Node.js ──────────────────────────────────────────────────────────
command -v node &>/dev/null || err "Node.js not found. Install from https://nodejs.org (v18+)"
NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
[ "$NODE_MAJOR" -ge 18 ] || err "Node.js v18+ required (current: v$NODE_VER)"
ok "Node.js v$NODE_VER"

command -v npm &>/dev/null || err "npm not found"
ok "npm $(npm -v)"

# ── 2. Get config from user ───────────────────────────────────────────────────
echo ""
ask "آدرس ERP [پیش‌فرض: $DEFAULT_URL]:"
read -r ERP_URL
ERP_URL="${ERP_URL:-$DEFAULT_URL}"

echo ""
ask "ERP_API_SECRET (کلیدی که در Vercel تنظیم کردی):"
read -rs ERP_SECRET
echo ""
[ -n "$ERP_SECRET" ] || err "ERP_API_SECRET نمی‌تونه خالی باشه"

# ── 3. Write MCP server files ─────────────────────────────────────────────────
echo ""
echo "📦 نصب MCP server در $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR/src"

# package.json
cat > "$INSTALL_DIR/package.json" << 'PKGJSON'
{
  "name": "themoak-erp-mcp",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  }
}
PKGJSON

# tsconfig.json
cat > "$INSTALL_DIR/tsconfig.json" << 'TSCJSON'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true
  }
}
TSCJSON

# src/index.ts — the full MCP server
cat > "$INSTALL_DIR/src/index.ts" << 'MCPSERVER'
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const BASE = (process.env.ERP_API_URL ?? '').replace(/\/$/, '');
const SECRET = process.env.ERP_API_SECRET ?? '';
if (!BASE || !SECRET) {
  process.stderr.write('ERROR: ERP_API_URL and ERP_API_SECRET are required\n');
  process.exit(1);
}

async function erpGet(action: string, params: Record<string, string> = {}) {
  const url = new URL(`${BASE}/api/erp`);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${SECRET}` } });
  if (!res.ok) throw new Error(`ERP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function erpPost(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/erp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ERP ${res.status}: ${await res.text()}`);
  return res.json();
}

const TOOLS = [
  { name: 'erp_summary', description: 'خلاصه مالی: موجودی کل حساب‌ها، درآمد/هزینه ۳۰ روز اخیر، تسویه‌های در انتظار', inputSchema: { type: 'object', properties: {} } },
  { name: 'erp_accounts', description: 'لیست همه حساب‌ها با موجودی، شماره کارت و شبا', inputSchema: { type: 'object', properties: {} } },
  { name: 'erp_transactions', description: 'تراکنش‌های اخیر (فیلتر بر اساس نوع)', inputSchema: { type: 'object', properties: {
    limit: { type: 'number', description: 'تعداد نتایج (پیش‌فرض ۵۰)' },
    type: { type: 'string', enum: ['INCOME','EXPENSE','TRANSFER'] }
  }}},
  { name: 'erp_orders', description: 'سفارش‌های فروش اخیر', inputSchema: { type: 'object', properties: {
    limit: { type: 'number', description: 'تعداد نتایج (پیش‌فرض ۳۰)' }
  }}},
  { name: 'erp_settlements', description: 'تسویه‌های امانت در انتظار پرداخت', inputSchema: { type: 'object', properties: {} } },
  { name: 'erp_loans', description: 'قرض‌های کارمندان', inputSchema: { type: 'object', properties: {} } },
  { name: 'erp_search', description: 'جستجو در مشتریان، محصولات، تراکنش‌ها و سفارش‌ها', inputSchema: { type: 'object', properties: {
    q: { type: 'string', description: 'متن جستجو (حداقل ۲ کاراکتر)' }
  }, required: ['q'] }},
  { name: 'erp_deposit', description: 'ثبت واریز پول به یک حساب', inputSchema: { type: 'object', properties: {
    accountId: { type: 'string' }, amount: { type: 'number' },
    currency: { type: 'string', enum: ['TOMAN','USD','EUR','CNY'], default: 'TOMAN' },
    description: { type: 'string' }, category: { type: 'string' }, date: { type: 'string' }
  }, required: ['accountId','amount','description'] }},
  { name: 'erp_expense', description: 'ثبت هزینه یا پرداخت از یک حساب', inputSchema: { type: 'object', properties: {
    accountId: { type: 'string' }, amount: { type: 'number' },
    currency: { type: 'string', enum: ['TOMAN','USD','EUR','CNY'], default: 'TOMAN' },
    description: { type: 'string' }, category: { type: 'string' },
    payee: { type: 'string' }, date: { type: 'string' }
  }, required: ['accountId','amount','description'] }},
  { name: 'erp_transfer', description: 'انتقال وجه بین دو حساب هم‌ارز', inputSchema: { type: 'object', properties: {
    fromAccountId: { type: 'string' }, toAccountId: { type: 'string' },
    amount: { type: 'number' }, description: { type: 'string' }, date: { type: 'string' }
  }, required: ['fromAccountId','toAccountId','amount'] }},
];

const server = new Server({ name: 'themoak-erp', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    let result: unknown;
    switch (name) {
      case 'erp_summary':      result = await erpGet('summary'); break;
      case 'erp_accounts':     result = await erpGet('accounts'); break;
      case 'erp_transactions': result = await erpGet('transactions', {
        ...(args.limit ? { limit: String(args.limit) } : {}),
        ...(args.type  ? { type:  String(args.type)  } : {}) }); break;
      case 'erp_orders':       result = await erpGet('orders', args.limit ? { limit: String(args.limit) } : {}); break;
      case 'erp_settlements':  result = await erpGet('settlements'); break;
      case 'erp_loans':        result = await erpGet('loans'); break;
      case 'erp_search':       result = await erpGet('search', { q: String(args.q) }); break;
      case 'erp_deposit':      result = await erpPost({ action: 'deposit',  ...args }); break;
      case 'erp_expense':      result = await erpPost({ action: 'expense',  ...args }); break;
      case 'erp_transfer':     result = await erpPost({ action: 'transfer', ...args }); break;
      default: return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (e: any) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write('TheMoak ERP MCP server running\n');
MCPSERVER

# ── 4. npm install + build ────────────────────────────────────────────────────
cd "$INSTALL_DIR"
echo "   npm install..."
npm install --silent

echo "   Building..."
# Try tsc first, fallback to esbuild
if npx --yes tsc --skipLibCheck 2>/dev/null; then
  ENTRY="$INSTALL_DIR/dist/index.js"
else
  npx --yes esbuild src/index.ts --bundle --platform=node --target=node18 \
    --format=esm --outfile=dist/index.js 2>/dev/null || err "Build failed"
  ENTRY="$INSTALL_DIR/dist/index.js"
fi

ok "MCP server آماده: $ENTRY"

# ── 5. Write Claude Desktop config ───────────────────────────────────────────
echo ""
echo "⚙️  تنظیم Claude Desktop..."

if [[ "$OSTYPE" == "darwin"* ]]; then
  CONFIG_DIR="$HOME/Library/Application Support/Claude"
else
  CONFIG_DIR="${APPDATA:-$HOME/.config}/Claude"
fi

CONFIG_FILE="$CONFIG_DIR/claude_desktop_config.json"
mkdir -p "$CONFIG_DIR"

# Backup existing config
[ -f "$CONFIG_FILE" ] && cp "$CONFIG_FILE" "$CONFIG_FILE.bak" && ok "پشتیبان: $CONFIG_FILE.bak"

# Merge or create config using node
node -e "
const fs = require('fs');
const configFile = '$CONFIG_FILE';
const cfg = fs.existsSync(configFile)
  ? (() => { try { return JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch(e) { return {}; } })()
  : {};
cfg.mcpServers = cfg.mcpServers || {};
cfg.mcpServers['themoak-erp'] = {
  command: 'node',
  args: ['$ENTRY'],
  env: { ERP_API_URL: '$ERP_URL', ERP_API_SECRET: '$ERP_SECRET' }
};
fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2));
console.log('done');
"

ok "Claude Desktop config آپدیت شد"

# ── 6. Done ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}  آماده‌ست! ✓${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  ۱. Claude Desktop رو ببند و دوباره باز کن"
echo "  ۲. آیکون 🔧 در کنار input رو ببین"
echo "  ۳. امتحان کن:"
echo '     "موجودی همه حساب‌هام رو نشون بده"'
echo '     "گزارش مالی ۳۰ روز گذشته"'
echo ""
echo "  Config: $CONFIG_FILE"
echo "  Server: $ENTRY"
echo ""
