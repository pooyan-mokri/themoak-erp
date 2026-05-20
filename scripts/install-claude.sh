#!/usr/bin/env bash
# TheMoak ERP — Claude Desktop Installer (zero dependencies)
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
[ "$NODE_MAJOR" -ge 18 ] || err "Node.js v18+ لازمه (الان: $(node -v))"
ok "Node.js $(node -v)"

# ── Get config ────────────────────────────────────────────────────────────────
echo ""
ask "آدرس ERP [Enter برای پیش‌فرض: $DEFAULT_URL]:"
read -r ERP_URL
ERP_URL="${ERP_URL:-$DEFAULT_URL}"
ERP_URL="${ERP_URL%/}"

echo ""
ask "ERP_API_SECRET (کلید Vercel):"
read -rs ERP_SECRET
echo ""
[ -n "$ERP_SECRET" ] || err "Secret نمی‌تونه خالی باشه"

# ── Write server (zero npm deps — uses only Node.js built-ins) ────────────────
echo ""
echo "📦 نوشتن MCP server در $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"

cat > "$INSTALL_DIR/server.mjs" << 'SERVEREOF'
#!/usr/bin/env node
/**
 * TheMoak ERP — MCP Server (zero dependencies, Node.js built-ins only)
 * Implements MCP stdio transport (newline-delimited JSON-RPC 2.0)
 */
import { createInterface } from 'readline';

const BASE   = (process.env.ERP_API_URL   ?? '').replace(/\/$/, '');
const SECRET = (process.env.ERP_API_SECRET ?? '');
if (!BASE || !SECRET) {
  process.stderr.write('ERROR: ERP_API_URL and ERP_API_SECRET required\n');
  process.exit(1);
}

// ── ERP API helpers ────────────────────────────────────────────────────────
const AUTH = { Authorization: `Bearer ${SECRET}` };

async function erpGet(action, params = {}) {
  const url = new URL(`${BASE}/api/erp`);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: AUTH });
  if (!res.ok) throw new Error(`ERP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function erpPost(body) {
  const res = await fetch(`${BASE}/api/erp`, {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ERP ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Tool definitions ───────────────────────────────────────────────────────
const TOOLS = [
  { name: 'erp_summary',      description: 'خلاصه مالی: موجودی کل حساب‌ها، درآمد/هزینه ۳۰ روز، تعداد تسویه‌های در انتظار', inputSchema: { type: 'object', properties: {} } },
  { name: 'erp_accounts',     description: 'لیست همه حساب‌ها با موجودی، شماره کارت و شبا', inputSchema: { type: 'object', properties: {} } },
  { name: 'erp_transactions', description: 'تراکنش‌های اخیر — فیلتر بر اساس نوع (INCOME/EXPENSE/TRANSFER)', inputSchema: { type: 'object', properties: {
    limit: { type: 'number', description: 'تعداد نتایج، پیش‌فرض ۵۰' },
    type:  { type: 'string', enum: ['INCOME','EXPENSE','TRANSFER'] },
  }}},
  { name: 'erp_orders',       description: 'سفارش‌های فروش اخیر با جزئیات مشتری و اقلام', inputSchema: { type: 'object', properties: {
    limit: { type: 'number', description: 'تعداد نتایج، پیش‌فرض ۳۰' },
  }}},
  { name: 'erp_settlements',  description: 'تسویه‌های امانت در انتظار پرداخت', inputSchema: { type: 'object', properties: {} } },
  { name: 'erp_loans',        description: 'قرض‌های کارمندان با مانده و وضعیت', inputSchema: { type: 'object', properties: {} } },
  { name: 'erp_search',       description: 'جستجو در مشتریان، محصولات، تراکنش‌ها و سفارش‌ها', inputSchema: { type: 'object', properties: {
    q: { type: 'string', description: 'متن جستجو (حداقل ۲ کاراکتر)' },
  }, required: ['q'] }},
  { name: 'erp_deposit',      description: 'ثبت واریز پول به یک حساب', inputSchema: { type: 'object', properties: {
    accountId:   { type: 'string', description: 'شناسه حساب (از erp_accounts بگیر)' },
    amount:      { type: 'number' },
    currency:    { type: 'string', enum: ['TOMAN','USD','EUR','CNY'], default: 'TOMAN' },
    description: { type: 'string', description: 'بابت چی؟' },
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

// ── MCP stdio transport (JSON-RPC 2.0, newline-delimited) ──────────────────
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function ok(id, result) { send({ jsonrpc: '2.0', id, result }); }
function fail(id, msg)  { send({ jsonrpc: '2.0', id, error: { code: -32000, message: msg } }); }

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  const { id, method, params } = msg;

  try {
    // ── MCP lifecycle ──
    if (method === 'initialize') {
      return ok(id, {
        protocolVersion: params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'themoak-erp', version: '1.0.0' },
      });
    }
    if (method === 'notifications/initialized') return; // no response needed
    if (method === 'ping') return ok(id, {});

    // ── Tools ──
    if (method === 'tools/list') return ok(id, { tools: TOOLS });

    if (method === 'tools/call') {
      const name = params?.name;
      const a    = params?.arguments ?? {};
      let result;

      switch (name) {
        case 'erp_summary':      result = await erpGet('summary'); break;
        case 'erp_accounts':     result = await erpGet('accounts'); break;
        case 'erp_transactions': result = await erpGet('transactions', {
          ...(a.limit && { limit: a.limit }),
          ...(a.type  && { type:  a.type  }),
        }); break;
        case 'erp_orders':       result = await erpGet('orders', a.limit ? { limit: a.limit } : {}); break;
        case 'erp_settlements':  result = await erpGet('settlements'); break;
        case 'erp_loans':        result = await erpGet('loans'); break;
        case 'erp_search':       result = await erpGet('search', { q: a.q }); break;
        case 'erp_deposit':      result = await erpPost({ action: 'deposit',  ...a }); break;
        case 'erp_expense':      result = await erpPost({ action: 'expense',  ...a }); break;
        case 'erp_transfer':     result = await erpPost({ action: 'transfer', ...a }); break;
        default: return fail(id, `Unknown tool: ${name}`);
      }

      return ok(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    }

    // unknown method
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });

  } catch (e) {
    if (id != null) fail(id, e.message);
  }
});

rl.on('close', () => process.exit(0));
process.stderr.write('TheMoak ERP MCP server running (no-deps mode)\n');
SERVEREOF

ok "Server نوشته شد (بدون npm، بدون build)"

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
