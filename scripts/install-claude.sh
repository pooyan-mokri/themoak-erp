#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# TheMoak ERP — Claude Desktop Auto-Installer
# Usage:  bash <(curl -fsSL https://raw.githubusercontent.com/pooyan-mokri/themoak-erp/main/scripts/install-claude.sh)
# ─────────────────────────────────────────────────────────────────────────────
set -e

REPO="https://github.com/pooyan-mokri/themoak-erp"
RAW="https://raw.githubusercontent.com/pooyan-mokri/themoak-erp/main"
INSTALL_DIR="$HOME/.themoak-erp-mcp"
DEFAULT_URL="https://themoak-erp.vercel.app"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "${RED}✗${NC} $*"; exit 1; }
ask()  { echo -e "${YELLOW}?${NC}  $*"; }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   TheMoak ERP → Claude Desktop Installer"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 1. Check Node.js ──────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  err "Node.js not found. Install from https://nodejs.org (v18 or newer)"
fi
NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node.js v18+ required. Current: v$NODE_VER — update from https://nodejs.org"
fi
ok "Node.js v$NODE_VER"

# ── 2. Check npm ──────────────────────────────────────────────────────────────
if ! command -v npm &>/dev/null; then
  err "npm not found. It should come with Node.js."
fi
ok "npm $(npm -v)"

# ── 3. Collect config ─────────────────────────────────────────────────────────
echo ""
ask "ERP URL (بدون / آخر) [پیش‌فرض: $DEFAULT_URL]:"
read -r ERP_URL
ERP_URL="${ERP_URL:-$DEFAULT_URL}"

echo ""
ask "ERP_API_SECRET (کلیدی که در Vercel تنظیم کردی):"
read -rs ERP_SECRET
echo ""
if [ -z "$ERP_SECRET" ]; then
  err "ERP_API_SECRET نمی‌تونه خالی باشه."
fi

# ── 4. Download & install MCP server ─────────────────────────────────────────
echo ""
echo "📦 دانلود و نصب MCP server..."

mkdir -p "$INSTALL_DIR/src"

# Download files from GitHub
curl -fsSL "$RAW/mcp-server/src/index.ts"    -o "$INSTALL_DIR/src/index.ts"
curl -fsSL "$RAW/mcp-server/package.json"    -o "$INSTALL_DIR/package.json"
curl -fsSL "$RAW/mcp-server/tsconfig.json"   -o "$INSTALL_DIR/tsconfig.json"

cd "$INSTALL_DIR"
npm install --silent
npx tsc --skipLibCheck 2>/dev/null || {
  # Fallback: bundle with esbuild if tsc fails
  npx esbuild src/index.ts --bundle --platform=node --target=node18 \
    --format=esm --outfile=dist/index.js 2>/dev/null || \
  err "Build failed. Check Node version and try again."
}

ok "MCP server نصب شد در $INSTALL_DIR"

# ── 5. Update Claude Desktop config ──────────────────────────────────────────
echo ""
echo "⚙️  تنظیم Claude Desktop..."

# Detect config path
if [[ "$OSTYPE" == "darwin"* ]]; then
  CONFIG_DIR="$HOME/Library/Application Support/Claude"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || -n "$APPDATA" ]]; then
  CONFIG_DIR="$APPDATA/Claude"
else
  CONFIG_DIR="$HOME/.config/Claude"
fi

CONFIG_FILE="$CONFIG_DIR/claude_desktop_config.json"
mkdir -p "$CONFIG_DIR"

# Build the new server entry
NEW_SERVER=$(cat <<JSON
{
  "command": "node",
  "args": ["$INSTALL_DIR/dist/index.js"],
  "env": {
    "ERP_API_URL": "$ERP_URL",
    "ERP_API_SECRET": "$ERP_SECRET"
  }
}
JSON
)

# Merge into existing config or create new
if [ -f "$CONFIG_FILE" ]; then
  # Backup existing config
  cp "$CONFIG_FILE" "$CONFIG_FILE.bak"
  ok "پشتیبان قبلی در $CONFIG_FILE.bak"

  # Use node to merge JSON (safer than sed)
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
    cfg.mcpServers = cfg.mcpServers || {};
    cfg.mcpServers['themoak-erp'] = $NEW_SERVER;
    fs.writeFileSync('$CONFIG_FILE', JSON.stringify(cfg, null, 2));
    console.log('merged');
  " 2>/dev/null || {
    # If existing config is broken JSON, start fresh
    warn "Config موجود معتبر نبود، فایل جدید ساخته می‌شه"
    echo "{\"mcpServers\":{\"themoak-erp\":$NEW_SERVER}}" | node -e \
      "const d=require('fs').readFileSync('/dev/stdin','utf8'); require('fs').writeFileSync('$CONFIG_FILE', JSON.stringify(JSON.parse(d),null,2));"
  }
else
  # Create new config
  node -e "
    const cfg = { mcpServers: { 'themoak-erp': $NEW_SERVER } };
    require('fs').writeFileSync('$CONFIG_FILE', JSON.stringify(cfg, null, 2));
  "
fi

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
echo '     "تسویه‌های در انتظار پرداخت"'
echo ""
echo "  Config file: $CONFIG_FILE"
echo "  Server dir:  $INSTALL_DIR"
echo ""
