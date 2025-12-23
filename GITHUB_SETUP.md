# راهنمای ذخیره پروژه در GitHub

## مراحل آماده‌سازی

### 1. بررسی وضعیت فعلی Git

```bash
# بررسی وضعیت
git status

# بررسی remote فعلی
git remote -v
```

### 2. حذف Remote قبلی (اگر نیاز باشد)

اگر remote فعلی مربوط به پروژه دیگری است:

```bash
git remote remove origin
```

### 3. اضافه کردن فایل‌های پروژه

```bash
# اضافه کردن همه فایل‌های تغییر یافته
git add .

# یا فقط فایل‌های خاص
git add src/
git add prisma/
git add public/
git add *.md
git add package.json
git add tsconfig.json
git add tailwind.config.ts
git add next.config.mjs
```

### 4. Commit کردن تغییرات

```bash
git commit -m "Initial commit: TheMoak ERP System

- Complete ERP system with 13 modules
- Sales, Inventory, Accounting, CRM, Projects
- AI Assistant integration
- WooCommerce integration
- Mobile responsive design
- Persian UI with Jalali calendar
- Complete documentation"
```

### 5. ایجاد Repository در GitHub

1. به [GitHub.com](https://github.com) بروید
2. روی **"+"** در بالای صفحه کلیک کنید
3. **"New repository"** را انتخاب کنید
4. اطلاعات زیر را وارد کنید:
   - **Repository name**: `themoak-erp`
   - **Description**: `Comprehensive ERP system for small and medium businesses with Persian UI`
   - **Visibility**: Private یا Public (انتخاب شما)
   - **⚠️ مهم**: **"Initialize this repository with a README"** را **تیک نزنید**
   - **⚠️ مهم**: **"Add .gitignore"** را **تیک نزنید**
   - **⚠️ مهم**: **"Choose a license"** را انتخاب نکنید
5. روی **"Create repository"** کلیک کنید

### 6. اتصال به GitHub Repository

بعد از ایجاد repository، GitHub دستورات زیر را نمایش می‌دهد. از دستورات **"push an existing repository"** استفاده کنید:

```bash
# اضافه کردن remote جدید
git remote add origin https://github.com/YOUR_USERNAME/themoak-erp.git

# یا اگر از SSH استفاده می‌کنید:
git remote add origin git@github.com:YOUR_USERNAME/themoak-erp.git

# Push کردن به GitHub
git branch -M main
git push -u origin main
```

### 7. بررسی نهایی

```bash
# بررسی remote
git remote -v

# بررسی وضعیت
git status

# مشاهده آخرین commit
git log --oneline -5
```

## نکات مهم

### فایل‌های که نباید commit شوند

فایل `.gitignore` قبلاً تنظیم شده و شامل موارد زیر است:
- `node_modules/`
- `.env*` (فایل‌های محیط)
- `.next/` (build files)
- `/backups` (فایل‌های بک‌آپ)
- `*.tsbuildinfo`
- `.DS_Store`

### امنیت

⚠️ **مهم**: هرگز فایل `.env` را commit نکنید! این فایل شامل:
- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- API Keys

### اگر خطا گرفتید

#### خطای "remote origin already exists"
```bash
git remote remove origin
git remote add origin YOUR_NEW_REPO_URL
```

#### خطای "failed to push"
```bash
# Pull کردن تغییرات (اگر وجود دارد)
git pull origin main --allow-unrelated-histories

# سپس push کنید
git push -u origin main
```

#### خطای Authentication
اگر از HTTPS استفاده می‌کنید و خطای authentication گرفتید:
1. از Personal Access Token استفاده کنید (نه password)
2. یا از SSH استفاده کنید

## دستورات کامل (Copy & Paste)

```bash
# 1. حذف remote قبلی (اگر نیاز باشد)
git remote remove origin

# 2. اضافه کردن فایل‌ها
git add .

# 3. Commit
git commit -m "Initial commit: TheMoak ERP System"

# 4. اضافه کردن remote جدید (بعد از ایجاد repository در GitHub)
git remote add origin https://github.com/YOUR_USERNAME/themoak-erp.git

# 5. Push
git branch -M main
git push -u origin main
```

## بعد از Push

1. ✅ Repository شما در GitHub ذخیره شد
2. ✅ می‌توانید README.md را در GitHub مشاهده کنید
3. ✅ می‌توانید Issues و Projects را فعال کنید
4. ✅ می‌توانید Actions برای CI/CD تنظیم کنید

---

**موفق باشید!** 🚀

