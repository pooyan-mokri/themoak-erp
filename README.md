# TheMoak ERP

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/your-repo/themoak-erp)
[![Next.js](https://img.shields.io/badge/Next.js-14.2.3-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Latest-blue)](https://www.postgresql.org/)

**TheMoak ERP** یک سیستم جامع مدیریت منابع سازمانی (ERP) برای کسب‌وکارهای کوچک و متوسط با رابط کاربری فارسی و تقویم شمسی.

**TheMoak ERP** is a comprehensive Enterprise Resource Planning (ERP) system for small and medium businesses with Persian UI and Jalali calendar support.

---

## 📋 فهرست مطالب / Table of Contents

- [ویژگی‌های اصلی](#ویژگی‌های-اصلی)
- [شروع سریع](#شروع-سریع)
- [نصب و راه‌اندازی](#نصب-و-راه‌اندازی)
- [ماژول‌ها](#ماژول‌ها)
- [مستندات](#مستندات)
- [تکنولوژی‌ها](#تکنولوژی‌ها)
- [مشارکت](#مشارکت)

- [Main Features](#main-features)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Modules](#modules)
- [Documentation](#documentation)
- [Technologies](#technologies)
- [Contributing](#contributing)

---

## ✨ ویژگی‌های اصلی / Main Features

### فارسی / Persian
- ✅ **مدیریت کامل فروش و خرید** - POS، فاکتورها، سفارشات
- ✅ **مدیریت انبار چندگانه** - ردیابی موجودی در چند انبار
- ✅ **حسابداری کامل** - حساب‌ها، تراکنش‌ها، گزارش‌های مالی
- ✅ **CRM و مدیریت مشتریان** - سرنخ‌ها، فرصت‌های فروش، پشتیبانی
- ✅ **مدیریت پروژه‌ها** - پروژه‌ها، وظایف، Kanban Board
- ✅ **مدیریت دارایی‌های ثابت** - ثبت و محاسبه استهلاک
- ✅ **مدیریت امانی** - همکاران امانی و تسویه حساب
- ✅ **حقوق و دستمزد** - مدیریت کارمندان و پرداخت حقوق
- ✅ **مدیریت وام‌ها** - وام‌های کارمندان
- ✅ **مدیریت سهامداران** - سرمایه‌گذاری و توزیع سود
- ✅ **یکپارچه‌سازی WooCommerce** - همگام‌سازی محصولات و سفارشات
- ✅ **دستیار هوش مصنوعی** - چت‌بات هوشمند با قابلیت Agent
- ✅ **گزارش‌گیری پیشرفته** - گزارش‌های فروش، مالی، موجودی
- ✅ **بک‌آپ خودکار** - پشتیبان‌گیری دوره‌ای از دیتابیس
- ✅ **رابط کاربری واکنش‌گرا** - پشتیبانی کامل از موبایل

### English
- ✅ **Complete Sales & Purchase Management** - POS, Invoices, Orders
- ✅ **Multi-Warehouse Management** - Track inventory across multiple warehouses
- ✅ **Complete Accounting** - Accounts, Transactions, Financial Reports
- ✅ **CRM & Customer Management** - Leads, Sales Opportunities, Support
- ✅ **Project Management** - Projects, Tasks, Kanban Board
- ✅ **Fixed Assets Management** - Asset Registration & Depreciation Calculation
- ✅ **Consignment Management** - Consignment Partners & Settlement
- ✅ **Payroll Management** - Employee & Salary Management
- ✅ **Loan Management** - Employee Loans
- ✅ **Shareholder Management** - Investments & Profit Distribution
- ✅ **WooCommerce Integration** - Product & Order Synchronization
- ✅ **AI Assistant** - Intelligent Chatbot with Agent Capabilities
- ✅ **Advanced Reporting** - Sales, Financial, Inventory Reports
- ✅ **Automatic Backup** - Periodic Database Backup
- ✅ **Responsive UI** - Full Mobile Support

---

## 🚀 شروع سریع / Quick Start

### فارسی

```bash
# نصب وابستگی‌ها
npm install

# کپی فایل محیط
cp .env.example .env

# ویرایش .env و تنظیم DATABASE_URL و NEXTAUTH_SECRET

# اجرای migrations
npx prisma migrate dev

# تولید Prisma Client
npx prisma generate

# اجرای سرور توسعه
npm run dev
```

سپس به [http://localhost:3000](http://localhost:3000) بروید.

### English

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env and set DATABASE_URL and NEXTAUTH_SECRET

# Run migrations
npx prisma migrate dev

# Generate Prisma Client
npx prisma generate

# Run development server
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📦 نصب و راه‌اندازی / Installation

### پیش‌نیازها / Prerequisites

- **Node.js** >= 18.17.0
- **PostgreSQL** >= 12
- **npm** یا **yarn** یا **pnpm**

### مراحل نصب / Installation Steps

#### 1. کلون کردن پروژه / Clone the Repository

```bash
git clone https://github.com/your-repo/themoak-erp.git
cd themoak-erp
```

#### 2. نصب وابستگی‌ها / Install Dependencies

```bash
npm install
```

#### 3. تنظیمات محیط / Environment Setup

یک فایل `.env` در ریشه پروژه ایجاد کنید:

```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/themoak_erp?schema=public"

# NextAuth
NEXTAUTH_SECRET="your-secret-key-here"
NEXTAUTH_URL="http://localhost:3000"
AUTH_SECRET="your-secret-key-here"

# Optional: WooCommerce Integration
WOOCOMMERCE_URL="https://your-store.com"
WOOCOMMERCE_CONSUMER_KEY="ck_..."
WOOCOMMERCE_CONSUMER_SECRET="cs_..."

# Optional: AI Assistant (OpenAI, Anthropic, Gemini, Groq)
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="sk-ant-..."
GEMINI_API_KEY="..."
GROQ_API_KEY="..."
```

#### 4. راه‌اندازی دیتابیس / Database Setup

```bash
# اجرای migrations
npx prisma migrate dev

# تولید Prisma Client
npx prisma generate

# (اختیاری) Seed کردن داده‌های اولیه
npx prisma db seed
```

#### 5. ایجاد کاربر اولیه / Create Initial User

از طریق رابط کاربری یا مستقیماً در دیتابیس یک کاربر با نقش `ADMIN` ایجاد کنید.

#### 6. اجرای برنامه / Run the Application

```bash
# حالت توسعه
npm run dev

# حالت تولید
npm run build
npm start
```

---

## 🎯 ماژول‌ها / Modules

### 1. داشبورد / Dashboard
**Route**: `/dashboard`

نمایش خلاصه مالی، نمودار فروش، هشدار موجودی کم، وظایف و فعالیت‌های اخیر.

### 2. مدیریت فروش / Sales Management
**Route**: `/dashboard/sales`

- POS (Point of Sale)
- مدیریت مشتریان
- فاکتورها
- سفارشات
- بازگشت و تعویض

### 3. مدیریت انبار / Inventory Management
**Route**: `/dashboard/inventory`

- تعریف محصولات
- مدیریت موجودی
- انبارها (چند انباره)
- دارایی‌های ثابت
- گزارش‌های موجودی
- ممیزی انبار

### 4. خرید و تامین‌کنندگان / Purchase & Suppliers
**Route**: `/dashboard/suppliers`

- مدیریت تامین‌کنندگان
- سفارشات خرید
- گردش کار کامل (DRAFT → RECEIVED)
- مدیریت هزینه‌های اضافی
- پشتیبانی از چند ارز

### 5. حسابداری / Accounting
**Route**: `/dashboard/accounting`

- حساب‌ها (بانکی و نقدی)
- ثبت درآمد و هزینه
- تراکنش‌های مالی
- نرخ ارز
- گزارش‌های مالی
- کارمندان
- حقوق و دستمزد

### 6. مدیریت پروژه / Project Management
**Route**: `/dashboard/projects`

- پروژه‌ها
- وظایف با Kanban Board
- Drag & Drop
- اولویت‌بندی
- بودجه پروژه

### 7. CRM / Customer Relationship Management
**Route**: `/dashboard/crm`

- مشتریان
- سرنخ‌ها (Leads)
- فرصت‌های فروش (Deals)
- پشتیبانی (Support Tickets)
- تبلیغات (Promotions)

### 8. مدیریت امانی / Consignment Management
**Route**: `/dashboard/consignment`

- همکاران امانی
- انتقال کالا
- تسویه حساب
- انبارهای مجازی

### 9. بازاریابی / Marketing
**Route**: `/dashboard/marketing`

- کمپین‌های بازاریابی
- هدایای بازاریابی

### 10. وام‌ها / Loans
**Route**: `/dashboard/accounting/loans`

- ثبت وام‌های کارمندان
- پرداخت‌های وام
- محاسبه باقیمانده

### 11. سهامداران / Shareholders
**Route**: `/dashboard/accounting/shareholders`

- مدیریت سهامداران
- سرمایه‌گذاری‌ها
- توزیع سود
- برداشت‌ها

### 12. WooCommerce Integration
**Route**: `/dashboard/woocommerce`

- همگام‌سازی محصولات
- همگام‌سازی سفارشات
- مدیریت تنظیمات

### 13. دستیار هوش مصنوعی / AI Assistant
**Route**: `/dashboard/assistant`

- چت‌بات هوشمند
- خواندن اطلاعات سیستم
- انجام عملیات (ایجاد مشتری، ثبت هزینه)
- پشتیبانی از OpenAI, Anthropic, Gemini, Groq

### 14. گزارش‌گیری / Reporting
**Route**: `/dashboard/reports`, `/dashboard/reporting`

- گزارش‌های فروش
- گزارش‌های مالی
- گزارش‌های موجودی
- گزارش‌های پروژه
- خروجی Excel

### 15. تنظیمات / Settings
**Route**: `/dashboard/settings`

- مدیریت کاربران
- نقش‌ها و دسترسی‌ها
- تنظیمات شرکت
- تنظیمات WooCommerce
- تنظیمات AI
- بک‌آپ

---

## 📚 مستندات / Documentation

برای مستندات کامل، به فایل‌های زیر مراجعه کنید:

For complete documentation, refer to the following files:

- **[SPECIFICATION.md](./SPECIFICATION.md)** - مشخصات کامل پروژه (Persian)
- **[DOCUMENTATION.md](./DOCUMENTATION.md)** - مستندات تفصیلی (Persian & English)
- **[AI_ASSISTANT_GUIDE.md](./AI_ASSISTANT_GUIDE.md)** - راهنمای دستیار AI (Persian)

---

## 🛠 تکنولوژی‌ها / Technologies

### Frontend
- **Next.js 14.2.3** - React Framework با App Router
- **React 18.3.1** - UI Library
- **TypeScript 5** - Type Safety
- **Tailwind CSS 3.4.18** - Styling
- **shadcn/ui** - UI Components
- **Radix UI** - Accessible Components
- **Recharts 3.5.1** - Charts
- **TanStack Query 5.90.10** - Data Fetching
- **Zustand 5.0.8** - State Management
- **date-fns-jalali** - Jalali Calendar

### Backend
- **Next.js Server Actions** - Server-side Logic
- **Prisma 5.22.0** - ORM
- **PostgreSQL** - Database
- **NextAuth.js 5.0.0** - Authentication
- **bcryptjs** - Password Hashing

### Integrations
- **WooCommerce REST API** - E-commerce Integration
- **OpenAI API** - AI Assistant
- **Anthropic API** - AI Assistant
- **Google Gemini API** - AI Assistant
- **Groq API** - AI Assistant

---

## 🔐 امنیت / Security

- رمزگذاری رمز عبور با bcrypt
- مدیریت نشست‌ها با NextAuth
- کنترل دسترسی بر اساس نقش (RBAC)
- اعتبارسنجی ورودی‌ها با Zod
- محافظت در برابر SQL Injection با Prisma
- مدیریت امن فایل‌ها

---

## 📱 پشتیبانی از موبایل / Mobile Support

- طراحی واکنش‌گرا (Responsive Design)
- منوی موبایلی با Sheet Component
- بهینه‌سازی فرم‌ها برای موبایل
- دسترسی سریع به بخش‌های مهم

---

## 🤝 مشارکت / Contributing

مشارکت‌ها خوش‌آمدند! لطفاً:

1. Fork کنید
2. یک branch برای feature ایجاد کنید (`git checkout -b feature/AmazingFeature`)
3. تغییرات را commit کنید (`git commit -m 'Add some AmazingFeature'`)
4. Push کنید به branch (`git push origin feature/AmazingFeature`)
5. Pull Request باز کنید

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 مجوز / License

این پروژه خصوصی است و تمام حقوق محفوظ است.

This project is private and all rights reserved.

---

## 👥 تیم / Team

- **TheMoak Team**

---

## 📞 پشتیبانی / Support

برای سوالات و پشتیبانی، لطفاً issue در GitHub باز کنید.

For questions and support, please open an issue on GitHub.

---

**نسخه / Version**: 0.1.0  
**آخرین به‌روزرسانی / Last Updated**: ۱۴۰۳/۱۰/۰۳
