#!/bin/bash

# راهنمای ذخیره پروژه TheMoak ERP در GitHub
# این اسکریپت به شما کمک می‌کند پروژه را برای GitHub آماده کنید

echo "🚀 راهنمای ذخیره پروژه در GitHub"
echo "=================================="
echo ""

# بررسی وجود git
if ! command -v git &> /dev/null; then
    echo "❌ Git نصب نیست. لطفاً ابتدا Git را نصب کنید."
    exit 1
fi

echo "✅ Git پیدا شد"
echo ""

# بررسی وضعیت git
echo "📊 بررسی وضعیت Git..."
git status --short | head -10
echo ""

# بررسی remote
echo "🔗 بررسی Remote فعلی..."
if git remote -v | grep -q "origin"; then
    echo "⚠️  Remote 'origin' وجود دارد:"
    git remote -v
    echo ""
    read -p "آیا می‌خواهید remote قبلی را حذف کنید؟ (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git remote remove origin
        echo "✅ Remote قبلی حذف شد"
    fi
else
    echo "✅ Remote وجود ندارد"
fi
echo ""

# اضافه کردن فایل‌ها
echo "📦 اضافه کردن فایل‌های پروژه..."
read -p "آیا می‌خواهید همه فایل‌ها را اضافه کنید؟ (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    git add .
    echo "✅ فایل‌ها اضافه شدند"
else
    echo "لطفاً به صورت دستی فایل‌ها را اضافه کنید:"
    echo "  git add src/ prisma/ public/ *.md package.json"
fi
echo ""

# Commit
echo "💾 Commit کردن تغییرات..."
read -p "پیام commit را وارد کنید (یا Enter برای پیام پیش‌فرض): " commit_message
if [ -z "$commit_message" ]; then
    commit_message="Initial commit: TheMoak ERP System

- Complete ERP system with 13 modules
- Sales, Inventory, Accounting, CRM, Projects
- AI Assistant integration
- WooCommerce integration
- Mobile responsive design
- Persian UI with Jalali calendar
- Complete documentation"
fi

read -p "آیا می‌خواهید commit کنید؟ (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    git commit -m "$commit_message"
    echo "✅ Commit انجام شد"
else
    echo "⚠️  Commit انجام نشد. می‌توانید بعداً انجام دهید:"
    echo "  git commit -m \"Your message\""
fi
echo ""

# راهنمای GitHub
echo "📝 مراحل بعدی:"
echo "=============="
echo ""
echo "1️⃣  به GitHub.com بروید و یک repository جدید بسازید:"
echo "   - نام: themoak-erp"
echo "   - ⚠️  README, .gitignore, License را اضافه نکنید"
echo ""
echo "2️⃣  بعد از ایجاد repository، دستورات زیر را اجرا کنید:"
echo ""
echo "   git remote add origin https://github.com/YOUR_USERNAME/themoak-erp.git"
echo "   git branch -M main"
echo "   git push -u origin main"
echo ""
echo "یا اگر از SSH استفاده می‌کنید:"
echo ""
echo "   git remote add origin git@github.com:YOUR_USERNAME/themoak-erp.git"
echo "   git branch -M main"
echo "   git push -u origin main"
echo ""
echo "📖 برای راهنمای کامل، فایل GITHUB_SETUP.md را مطالعه کنید."
echo ""
echo "✅ آماده است!"

