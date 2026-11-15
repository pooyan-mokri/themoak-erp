# TheMoak ERP — AI Connector

اتصال ERP به **Claude Desktop** و **ChatGPT** با زبان طبیعی.

---

## اتصال به Claude Desktop (مک و ویندوز)

کانکتور یک فایل است: `mcp-server/server.mjs`، بدون هیچ وابستگی (فقط Node 18 به بالا).
ERP همان را به‌صورت یک بستهٔ نصب (`.mcpb`) برای دانلود می‌دهد؛ همین یک فایل روی مک و
ویندوز نصب می‌شود و هیچ کلیدی داخلش نیست.

1. در ERP: **تنظیمات ← کاربران ← کلیدهای Claude** (آیکون ربات کنار هر کاربر). برای
   کاربر یک کلید بسازید؛ کلید فقط همان یک بار نشان داده می‌شود.
2. همان‌جا **«دانلود کانکتور (مک و ویندوز)»** را بزنید (`themoak-erp.mcpb`).
3. در Claude Desktop: **Settings ← Extensions**، فایل را آن‌جا بکشید (یا دو بار رویش
   کلیک کنید) و **Install** را بزنید.
4. آدرس ERP از قبل پر شده است؛ کلید را در «کلید Claude» وارد کنید و کانکتور را روشن کنید.

هر کاری که Claude با کلید شخصی انجام دهد به نام همان کاربر و با دسترسی‌های نقش او ثبت
می‌شود، و Claude فقط ابزارهایی را می‌بیند که آن نقش اجازه دارد. با کلید کامل مالک
(`ERP_API_SECRET`) همهٔ ابزارها هست جز پنج ابزاری که به نام یک کاربر ثبت می‌شوند
(مشتری، سفارش فروش، پرداخت سفارش فروش، مرجوعی، انتقال کالا). پرداخت سفارش خرید با کلید
شخصیِ نقشی که `finance.manage` دارد هم انجام می‌شود، و هزینهٔ تازهٔ سفارش خرید با `cost.edit`. کلید سایت (`ERP_SITE_API_SECRET`) به کار کانکتور نمی‌آید.

### نصب دستی (بدون بسته)

از همان پنجره «فقط فایل سرور» را دانلود کنید (یا `mcp-server/server.mjs` را بردارید) و
در فایل تنظیمات Claude Desktop بگذارید
(مک: `~/Library/Application Support/Claude/claude_desktop_config.json`،
ویندوز: `%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "themoak-erp": {
      "command": "node",
      "args": ["/path/to/themoak-erp-server.mjs"],
      "env": { "ERP_API_URL": "https://erp.example.com", "ERP_API_KEY": "tmk_…" }
    }
  }
}
```

### برای توسعه‌دهنده

بعد از هر تغییر در `server.mjs`، `node mcp-server/embed.mjs` را اجرا کنید: نسخه‌ای که ERP
برای دانلود می‌دهد (`src/lib/connector-server.generated.ts`) از روی آن ساخته می‌شود و تا
وقتی این دو یکی نباشند `tests/platform/connector.test.ts` رد می‌شود. شمارهٔ نسخه
(`VERSION`) را هم بالا ببرید تا Claude Desktop بستهٔ تازه را نسخهٔ جدید ببیند.

- **"موجودی همه حساب‌هام رو نشونم بده"**
- **"۲۰۰۰ یوان برای PO-8 از حساب ذخیره دلاری پرداخت شد، نرخ بانک ۶٫۶۷۰۳"**
- **"لیست سفارش بعدی رو بر اساس فروش ۹۰ روز اخیر بده"**

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
| `erp_inventory` | موجودی هر کالا در هر انبار — صفرها، کم‌موجودی‌ها، ردیف‌های منفی |
| `erp_product_sales` | فروش هر کالا در بازهٔ اخیر کنار موجودی: چند ماه دیگر کافی است |
| `erp_deposit` | ثبت واریز |
| `erp_expense` | ثبت هزینه/پرداخت |
| `erp_transfer` | انتقال وجه بین حساب‌های هم‌ارز |
| `erp_suppliers` | تأمین‌کننده‌ها با تعداد سفارش خریدشان |
| `erp_purchase_orders` | سفارش‌های خرید اخیر، با فیلتر تأمین‌کننده، وضعیت یا برچسب (مثلاً `PI:2026-031`) |
| `erp_whoami` | این کلید مال کیست و چه کارهایی می‌تواند بکند |
| `erp_warehouses` | انبارهای فعال |
| `erp_create_customer` | ثبت مشتری (کلید شخصی) |
| `erp_create_order` | ثبت سفارش فروش (کلید شخصی) |
| `erp_record_payment` | پرداخت مشتری برای سفارش **فروش** (کلید شخصی) |
| `erp_return_order_item` | مرجوعی یک قلم از سفارش فروش (کلید شخصی) |
| `erp_transfer_stock` | انتقال کالا بین دو انبار (کلید شخصی) |
| `erp_create_supplier` | ثبت تأمین‌کننده (نام تکراری رد می‌شود) |
| `erp_create_product` | ثبت کالا مثل فرم کالا؛ روی سایت نمی‌رود تا شناسهٔ سایتش گذاشته شود |
| `erp_create_purchase_order` | ثبت سفارش خرید به ارز PI تأمین‌کننده (معمولاً یوان)، بدون تومان؛ تومانش موقع پرداخت با نرخ پرداخت معلوم می‌شود. هر PI یک بار |
| `erp_pay_purchase_order` | پرداخت سفارش **خرید** به ارزی که واقعاً پرداخت شده (مثلاً یوان از حساب دلاری، با نرخ بانک و نرخ تومان). ماندهٔ سفارش به ارز خودش؛ با تسویهٔ کامل، قیمت تومانی اقلام با نرخ واقعی پرداخت ثبت می‌شود |
| `erp_add_purchase_order_cost` | افزودن هزینهٔ تازه به سفارش خرید، به ارز سفارش (مثلاً حک لوگو)؛ سفارشِ «پرداخت شده» به «پرداخت جزئی» برمی‌گردد |

ابزارهای ثبت قبل از ثبت، خلاصه را برای کاربر می‌خوانند و تأیید می‌گیرند. جزئیات در `docs/erp-api.md`، بخش «خرید».

نمونه: **«۲۰۰۰ یوان برای PO-8 از حساب ذخیره دلاری پرداخت شد، نرخ بانک ۶٫۶۷۰۳ و دلار ۲۷۱٬۰۰۰ تومان»** → از حساب دلاری `2000 ÷ 6.6703 = $299.84` کم می‌شود و ارزش تومانی `299.84 × 271,000 = 81,256,640` تومان ثبت می‌شود.

---

## عیب‌یابی

| مشکل | راه‌حل |
|------|--------|
| Claude ابزار ERP نشون نمیده | Restart کن Claude Desktop |
| خطای `401 Unauthorized` | کلید درست نیست یا باطل شده؛ در ERP کلید تازه بساز و در تنظیمات کانکتور بگذار |
| خطای `403 Forbidden for this key` | در config کلید سایت (`ERP_SITE_API_SECRET`) رو گذاشتی؛ `ERP_API_SECRET` رو بذار |
| خطای `No exchange rate for USD` | نرخ ارز رو در ERP → نرخ ارز اضافه کن |
| نصب مجدد یا به‌روزرسانی | بستهٔ تازه را از ERP دانلود و دوباره نصب کن |
