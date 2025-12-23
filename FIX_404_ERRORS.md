# راه حل خطاهای 404

## مشکل:
```
POST http://localhost:3000/dashboard/settings 404 (Not Found)
GET http://localhost:3000/_next/static/css/app/layout.css 404
```

## علت:
Next.js cache (.next folder) نیاز به پاک شدن و rebuild دارد.

## راه حل (انجام شده ✅):

### 1. Cache پاک شد ✅
```bash
rm -rf .next
```

### 2. حالا Dev Server را Restart کنید:

**در ترمینال که `npm run dev` اجراست:**

```bash
# توقف سرور
Ctrl + C

# شروع مجدد
npm run dev
```

### 3. صفحه مرورگر را Refresh کنید:
- `F5` یا `Cmd/Ctrl + R`
- یا Hard Refresh: `Cmd/Ctrl + Shift + R`

---

## اگر همچنان 404 دارید:

### گزینه 1: Kill تمام process های Node
```bash
# macOS/Linux
killall node

# سپس
npm run dev
```

### گزینه 2: پاک کردن کامل و نصب مجدد
```bash
rm -rf .next node_modules
npm install
npm run dev
```

### گزینه 3: تغییر Port
```bash
# در package.json یا
PORT=3001 npm run dev
```

---

## بررسی:
بعد از restart، این URLها باید کار کنند:
- ✅ `/dashboard/assistant` - صفحه دستیار AI
- ✅ `/dashboard/settings` - تنظیمات شرکت
- ✅ تمام CSS files

**فقط کافیست dev server را restart کنید!** 🔄

