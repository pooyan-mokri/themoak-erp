# دستورالعمل راه‌اندازی مجدد

## مشکل: Failed to fetch AI settings

این خطا به دلیل عدم همگام‌سازی Prisma Client با Next.js رخ داده است.

## راه حل:

### گام 1: پاک کردن cache (انجام شد ✅)
```bash
rm -rf .next
```

### گام 2: Restart کردن Dev Server

**در ترمینال جاری که `npm run dev` در آن اجرا شده:**

1. سرور را متوقف کنید: `Ctrl + C`
2. دوباره سرور را اجرا کنید:
```bash
npm run dev
```

### گام 3: Refresh کردن مرورگر

بعد از اینکه سرور مجدداً start شد:
1. به `/dashboard/assistant` بروید
2. صفحه را Refresh کنید (F5 یا Cmd/Ctrl + R)

---

## اگر همچنان خطا دارید:

### بررسی دیتابیس:
```bash
npx prisma studio
```

اگر جداول `AISettings`, `AIConversation`, `AIMessage`, `AIAction` را مشاهده نکردید:

```bash
npx prisma db push
```

### اگر همچنان کار نکرد:
```bash
# پاک کردن کامل node_modules
rm -rf node_modules .next
npm install
npx prisma generate
npm run dev
```

---

## تغییرات انجام شده:

✅ Error handling بهتر شد - حالا خطا نمایش داده می‌شود  
✅ Default settings برگردانده می‌شود اگر دیتابیس مشکل داشته باشد  
✅ Prisma Client regenerate شد  
✅ .next cache پاک شد  

فقط کافیست **dev server را restart** کنید! 🚀

