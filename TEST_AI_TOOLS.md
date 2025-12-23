# تست ابزارهای AI Agent

## تغییرات انجام شده ✅

### 1. بهبود Regex Pattern
- ✅ حالا می‌تواند `{}` خالی را بخواند
- ✅ می‌تواند JSON های چندخطی را parse کند
- ✅ Pattern: `/\[TOOL:(\w+)\]\s*(\{[\s\S]*?\})\s*\[\/TOOL\]/g`

### 2. اضافه شدن Logging
- ✅ هر tool call لاگ می‌شود
- ✅ نتایج در console نمایش داده می‌شوند
- ✅ خطاها به کاربر نشان داده می‌شوند

### 3. بهبود System Prompt
- ✅ مثال‌های واضح‌تر
- ✅ توضیحات بهتر برای AI
- ✅ فرمت JSON صحیح

### 4. Error Handling
- ✅ هر ابزار try-catch دارد
- ✅ خطاها در database ثبت می‌شوند
- ✅ پیام خطا به کاربر نمایش داده می‌شود

## نحوه تست

### مرحله 1: Restart Server
```bash
# در ترمینال
Ctrl + C
npm run dev
```

### مرحله 2: رفتن به صفحه Assistant
- به `/dashboard/assistant` بروید
- یک مکالمه جدید ایجاد کنید

### مرحله 3: تست سوالات

#### تست 1: موجودی انبار
```
موجودی انبار چطوره؟
```

**انتظار:**
- AI باید از `get_inventory_summary` استفاده کند
- نتیجه JSON نمایش داده شود
- توضیحات فارسی

#### تست 2: فروش
```
فروش 7 روز گذشته رو نشون بده
```

**انتظار:**
- AI باید از `get_sales_summary` با `{"days": 7}` استفاده کند
- آمار فروش نمایش داده شود

#### تست 3: جستجوی محصول
```
محصول "تست" رو پیدا کن
```

**انتظار:**
- AI باید از `search_products` استفاده کند
- لیست محصولات نمایش داده شود

### مرحله 4: بررسی Console
در مرورگر (F12 → Console):
```
[AI AGENT] Tool call detected: get_inventory_summary {}
[AI AGENT] Executing tool: get_inventory_summary with params: {}
[AI AGENT] Tool result: {...}
```

در ترمینال سرور:
```
prisma:query SELECT ...
```

## اگر همچنان کار نکرد:

### بررسی 1: API Key
- به تنظیمات بروید
- مطمئن شوید API Key صحیح است
- Provider را روی GROQ تنظیم کنید (رایگان)

### بررسی 2: Database
```bash
npx prisma studio
```
- جداول `AISettings`, `AIConversation`, `AIMessage` را چک کنید

### بررسی 3: Console Logs
- در مرورگر F12 را باز کنید
- در ترمینال سرور لاگ‌ها را ببینید

## مثال پاسخ صحیح:

```
کاربر: موجودی انبار چطوره؟

دستیار: 
[TOOL:get_inventory_summary]
{}
[/TOOL]

📊 نتیجه عملیات get_inventory_summary:
{
  "success": true,
  "totalProducts": 150,
  "totalItems": 5000,
  "totalValue": 45000000,
  "lowStockCount": 5,
  "lowStockItems": [...]
}

شما در حال حاضر 150 محصول با مجموع 5000 عدد در انبار دارید.
ارزش کل موجودی: 45 میلیون تومان
5 محصول موجودی کم دارند که نیاز به سفارش دارند.
```

---

**فقط کافیست server را restart کنید و دوباره تست کنید!** 🚀

