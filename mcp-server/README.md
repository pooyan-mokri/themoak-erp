# TheMoak ERP — AI Connector

اتصال ERP به **Claude Desktop** و **ChatGPT** با زبان طبیعی.

---

## اتصال به Claude Desktop — یه دستور

### مرحله ۱ — Secret در Vercel تنظیم کن

یه کلید امن بساز:
```bash
openssl rand -base64 32
```

در **Vercel Dashboard → Settings → Environment Variables** اضافه کن:

| Name | Value |
|------|-------|
| `ERP_API_SECRET` | مقدار بالا |

یک بار Redeploy کن.

### مرحله ۲ — نصب خودکار

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/pooyan-mokri/themoak-erp/main/scripts/install-claude.sh)
```

این script:
- Node.js رو چک می‌کنه
- MCP server رو دانلود و نصب می‌کنه
- آدرس ERP و Secret رو ازت می‌پرسه
- فایل config کلود رو خودکار آپدیت می‌کنه

### مرحله ۳ — Claude Desktop رو restart کن

آیکون 🔧 ظاهر میشه. تست کن:

- **"موجودی همه حساب‌هام رو نشونم بده"**
- **"گزارش مالی ۳۰ روز گذشته"**
- **"تسویه‌های در انتظار پرداخت"**
- **"۵ میلیون از بانک ملت به صندوق منتقل کن"**
- **"یه هزینه ۲ میلیونی بابت اجاره ثبت کن"**

---

## اتصال به ChatGPT

1. برو [chat.openai.com](https://chat.openai.com) → **Explore GPTs** → **Create a GPT**
2. نام: **TheMoak ERP Assistant**
3. System prompt:
```
You are a financial assistant for TheMoak ERP.
Query accounts, transactions, orders, settlements, loans.
Record deposits, expenses, and transfers.
Confirm write operations before executing. Show amounts in Persian format with تومان.
```
4. **Configure → Actions → Create new action**
5. Schema URL:
```
https://themoak-erp.vercel.app/openapi.json
```
6. Authentication: **API Key → Bearer** → مقدار `ERP_API_SECRET`
7. Save و تست.

---

## ابزارهای در دسترس

| ابزار | توضیح |
|-------|-------|
| `erp_summary` | خلاصه مالی: موجودی‌ها، سود/زیان ۳۰ روز |
| `erp_accounts` | لیست حساب‌ها با موجودی، شماره کارت، شبا |
| `erp_transactions` | تراکنش‌های اخیر (فیلتر بر نوع) |
| `erp_orders` | سفارش‌های فروش اخیر |
| `erp_settlements` | تسویه‌های امانت در انتظار |
| `erp_loans` | قرض‌های کارمندان |
| `erp_search` | جستجوی کلی در همه بخش‌ها |
| `erp_deposit` | ثبت واریز |
| `erp_expense` | ثبت هزینه/پرداخت |
| `erp_transfer` | انتقال وجه بین حساب‌های هم‌ارز |

---

## عیب‌یابی

| مشکل | راه‌حل |
|------|--------|
| Claude ابزار ERP نشون نمیده | Restart کن Claude Desktop |
| خطای `401 Unauthorized` | مطمئن شو Secret در Vercel و config یکیه |
| خطای `No exchange rate for USD` | نرخ ارز رو در ERP → نرخ ارز اضافه کن |
| نصب مجدد | دوباره همون script رو اجرا کن |
