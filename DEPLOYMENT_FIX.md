# رفع خطای Deployment در Vercel

## مشکل

خطای `EBADPLATFORM` برای `@next/swc-darwin-arm64` - این بسته فقط برای macOS ARM64 است و در Vercel (Linux x64) کار نمی‌کند.

## راه‌حل

بسته `@next/swc-darwin-arm64` از `package.json` حذف شد. Next.js به صورت خودکار بسته مناسب را برای هر پلتفرم نصب می‌کند.

## مراحل بعدی

### 1. Commit و Push تغییرات

```bash
git add package.json
git commit -m "Remove platform-specific @next/swc-darwin-arm64 from dependencies"
git push origin main
```

### 2. به‌روزرسانی package-lock.json (اختیاری)

اگر می‌خواهید `package-lock.json` را هم به‌روزرسانی کنید (Vercel این کار را خودش انجام می‌دهد):

```bash
npm install
git add package-lock.json
git commit -m "Update package-lock.json"
git push origin main
```

یا می‌توانید این کار را به Vercel بسپارید - Vercel خودش `package-lock.json` را به‌روزرسانی می‌کند.

### 3. Deploy در Vercel

بعد از push، Vercel به صورت خودکار rebuild می‌کند. یا می‌توانید:
- به Vercel Dashboard بروید
- روی "Redeploy" کلیک کنید

---

## توضیح

`@next/swc-darwin-arm64` یک بسته platform-specific است که Next.js به صورت خودکار و اختیاری نصب می‌کند. نباید در `dependencies` یا `devDependencies` باشد.

Next.js در زمان build بسته مناسب را برای پلتفرم مورد نظر انتخاب می‌کند:
- `@next/swc-darwin-arm64` برای macOS ARM64
- `@next/swc-darwin-x64` برای macOS Intel
- `@next/swc-linux-x64-gnu` برای Linux x64
- و غیره

---

**بعد از push، deployment باید با موفقیت انجام شود!** ✅

