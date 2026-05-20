# TheMoak ERP — AI Connector

Connect your ERP to **Claude** (Desktop & claude.ai) and **ChatGPT** so you can query financial data and record transactions using natural language.

---

## Architecture

```
Claude Desktop ──► MCP Server (local Node.js) ──► /api/erp (Vercel) ──► PostgreSQL
ChatGPT         ──────────────────────────────────► /api/erp (Vercel) ──► PostgreSQL
```

---

## Step 1 — Set the API Secret on Vercel

Generate a strong secret and add it to your Vercel project:

```bash
openssl rand -base64 32
# Example output: x3kP9mQs7rLz...
```

In **Vercel Dashboard → Your Project → Settings → Environment Variables**:

| Name | Value |
|------|-------|
| `ERP_API_SECRET` | `<the value you generated>` |

Redeploy once so the variable takes effect.

---

## Step 2A — Connect to Claude Desktop (MCP)

### Install the MCP server

```bash
# Clone or go to your ERP repo
cd /path/to/themoak-erp/mcp-server

# Install dependencies
npm install

# Build
npm run build
```

### Configure Claude Desktop

Open (or create) your Claude Desktop config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add the following (replace paths and values):

```json
{
  "mcpServers": {
    "themoak-erp": {
      "command": "node",
      "args": ["/FULL/PATH/TO/themoak-erp/mcp-server/dist/index.js"],
      "env": {
        "ERP_API_URL": "https://themoak-erp.vercel.app",
        "ERP_API_SECRET": "YOUR_SECRET_HERE"
      }
    }
  }
}
```

Restart Claude Desktop. You should see **TheMoak ERP** in the tools panel (🔧 icon).

### Test it in Claude

Try saying:
- **"موجودی همه حساب‌هایم رو نشونم بده"**
- **"گزارش مالی ۳۰ روز گذشته"**
- **"تسویه‌های در انتظار پرداخت"**
- **"۵ میلیون تومان از حساب بانک ملت به صندوق نقد منتقل کن"**
- **"یه هزینه ۲ میلیونی بابت اجاره دفتر ثبت کن"**

---

## Step 2B — Connect to ChatGPT (GPT Actions)

### Create a Custom GPT

1. Go to [chat.openai.com](https://chat.openai.com) → **Explore GPTs** → **Create a GPT**
2. Name it: **TheMoak ERP Assistant**
3. In the system prompt, paste:

```
You are a financial assistant connected to TheMoak ERP system.
You can query accounts, transactions, orders, consignment settlements, and employee loans.
You can also record deposits, expenses, and internal transfers.
Always confirm write operations with the user before executing them.
When showing amounts, format numbers with Persian numerals and add "تومان" for Toman amounts.
```

4. Go to **Configure** → **Actions** → **Create new action**

5. In the schema field, paste the URL:
```
https://themoak-erp.vercel.app/openapi.json
```
(Or paste the contents of `public/openapi.json` directly.)

6. Under **Authentication**, choose **API Key** → **Bearer** and enter your `ERP_API_SECRET`.

7. Save and test.

### Test in ChatGPT

Try:
- "What's my current financial summary?"
- "Show me all bank accounts and their balances"
- "List pending consignment settlements"
- "Record a 5,000,000 Toman deposit to account [ID] for office rent"

---

## Available Tools / Actions

| Tool | Description |
|------|-------------|
| `erp_summary` | Financial overview: balances, 30-day P&L, pending count |
| `erp_accounts` | All accounts with balance, card number, IBAN |
| `erp_transactions` | Recent transactions (filterable by type) |
| `erp_orders` | Recent sales orders |
| `erp_settlements` | Pending consignment settlements |
| `erp_loans` | Employee loans |
| `erp_search` | Search across all entities |
| `erp_deposit` | Record a deposit into an account |
| `erp_expense` | Record an expense/payment from an account |
| `erp_transfer` | Transfer between two same-currency accounts |

---

## Security Notes

- The `ERP_API_SECRET` is a Bearer token — treat it like a password.
- All write operations (deposit, expense, transfer) go through the same validation as the web UI.
- The API does **not** expose passwords, auth tokens, or user credentials.
- For extra safety, you can create a **read-only secret** by adding a second env var `ERP_API_SECRET_READONLY` and restricting POST routes to the full secret only.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Claude shows no ERP tools | Restart Claude Desktop after editing config |
| `401 Unauthorized` | Check `ERP_API_SECRET` matches in Vercel and config |
| `No exchange rate for USD` | Add today's exchange rate in ERP → حسابداری → نرخ ارز |
| MCP server won't start | Run `npm run build` first; check Node ≥ 18 |
