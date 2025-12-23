# مستندات کامل TheMoak ERP / Complete Documentation

**نسخه / Version**: 1.0  
**تاریخ آخرین به‌روزرسانی / Last Updated**: ۱۴۰۳/۱۰/۰۳

---

## فهرست مطالب / Table of Contents

1. [معرفی / Introduction](#معرفی--introduction)
2. [معماری سیستم / System Architecture](#معماری-سیستم--system-architecture)
3. [نصب و راه‌اندازی / Installation & Setup](#نصب-و-راه‌اندازی--installation--setup)
4. [ماژول‌ها / Modules](#ماژول‌ها--modules)
5. [API و Server Actions](#api-و-server-actions)
6. [امنیت / Security](#امنیت--security)
7. [توسعه / Development](#توسعه--development)
8. [استقرار / Deployment](#استقرار--deployment)

---

## معرفی / Introduction

### فارسی

**TheMoak ERP** یک سیستم مدیریت منابع سازمانی (ERP) جامع است که برای کسب‌وکارهای کوچک و متوسط طراحی شده است. این سیستم با استفاده از فناوری‌های مدرن وب و رابط کاربری فارسی، تمامی جنبه‌های مدیریتی یک کسب‌وکار را پوشش می‌دهد.

### English

**TheMoak ERP** is a comprehensive Enterprise Resource Planning (ERP) system designed for small and medium businesses. Built with modern web technologies and Persian UI, it covers all aspects of business management.

### ویژگی‌های کلیدی / Key Features

- ✅ **مدیریت کامل کسب‌وکار** / Complete Business Management
- ✅ **رابط کاربری فارسی** / Persian User Interface
- ✅ **تقویم شمسی** / Jalali Calendar Support
- ✅ **چند ارز** / Multi-Currency Support
- ✅ **چند انباره** / Multi-Warehouse Support
- ✅ **یکپارچه‌سازی WooCommerce** / WooCommerce Integration
- ✅ **دستیار هوش مصنوعی** / AI Assistant
- ✅ **واکنش‌گرا** / Responsive Design
- ✅ **Dark Mode** / حالت تاریک

---

## معماری سیستم / System Architecture

### معماری کلی / Overall Architecture

سیستم بر اساس **Next.js 14 App Router** ساخته شده است:

- **Server Components**: صفحات و کامپوننت‌های سرور برای عملکرد بهتر
- **Client Components**: کامپوننت‌های تعاملی در سمت کلاینت
- **Server Actions**: تمام عملیات دیتابیس در سمت سرور
- **API Routes**: برای احراز هویت و یکپارچه‌سازی‌های خارجی

### ساختار پروژه / Project Structure

```
themoak-erp/
├── prisma/              # Database schema and migrations
│   ├── schema.prisma   # Prisma schema
│   └── migrations/     # Database migrations
├── public/             # Static files
│   └── uploads/       # Uploaded files (receipts, images)
├── src/
│   ├── actions/       # Server Actions
│   │   ├── accounting.ts
│   │   ├── sales.ts
│   │   ├── inventory.ts
│   │   └── ...
│   ├── app/           # Next.js App Router pages
│   │   ├── dashboard/ # Dashboard pages
│   │   ├── api/       # API routes
│   │   └── ...
│   ├── components/    # React components
│   │   ├── ui/        # UI components (shadcn/ui)
│   │   ├── layout/    # Layout components
│   │   ├── accounting/ # Accounting components
│   │   └── ...
│   ├── lib/           # Utility functions
│   │   ├── prisma.ts  # Prisma client
│   │   ├── auth.ts    # Authentication utilities
│   │   └── ...
│   └── middleware.ts  # Next.js middleware
├── .env               # Environment variables
├── package.json       # Dependencies
└── README.md          # Project README
```

### دیتابیس / Database

- **Database**: PostgreSQL
- **ORM**: Prisma 5.22.0
- **Migrations**: Prisma Migrations
- **Schema Location**: `prisma/schema.prisma`

---

## نصب و راه‌اندازی / Installation & Setup

### پیش‌نیازها / Prerequisites

- **Node.js** >= 18.17.0
- **PostgreSQL** >= 12
- **npm** یا **yarn** یا **pnpm**

### مراحل نصب / Installation Steps

#### 1. کلون کردن پروژه / Clone Repository

```bash
git clone https://github.com/your-repo/themoak-erp.git
cd themoak-erp
```

#### 2. نصب وابستگی‌ها / Install Dependencies

```bash
npm install
```

#### 3. تنظیمات محیط / Environment Configuration

یک فایل `.env` در ریشه پروژه ایجاد کنید:

```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/themoak_erp?schema=public"

# NextAuth
NEXTAUTH_SECRET="your-secret-key-here-min-32-chars"
NEXTAUTH_URL="http://localhost:3000"
AUTH_SECRET="your-secret-key-here-min-32-chars"

# Optional: WooCommerce Integration
WOOCOMMERCE_URL="https://your-store.com"
WOOCOMMERCE_CONSUMER_KEY="ck_..."
WOOCOMMERCE_CONSUMER_SECRET="cs_..."

# Optional: AI Assistant
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="sk-ant-..."
GEMINI_API_KEY="..."
GROQ_API_KEY="..."
```

**نکته / Note**: برای تولید `NEXTAUTH_SECRET` می‌توانید از دستور زیر استفاده کنید:
```bash
openssl rand -base64 32
```

#### 4. راه‌اندازی دیتابیس / Database Setup

```bash
# اجرای migrations
npx prisma migrate dev

# تولید Prisma Client
npx prisma generate

# (اختیاری) مشاهده دیتابیس در Prisma Studio
npx prisma studio
```

#### 5. ایجاد کاربر اولیه / Create Initial User

از طریق رابط کاربری یا مستقیماً در دیتابیس:

```sql
-- Hash password با bcrypt (مثلاً برای رمز "admin123")
INSERT INTO "User" (id, name, email, password, role, "createdAt", "updatedAt")
VALUES (
  'cuid-here',
  'مدیر سیستم',
  'admin@example.com',
  '$2a$10$hash-here', -- bcrypt hash
  'ADMIN',
  NOW(),
  NOW()
);
```

یا از طریق رابط کاربری:
1. به `/login` بروید
2. اولین کاربر خودکار به عنوان ADMIN ایجاد می‌شود (اگر تنظیمات اجازه دهد)

#### 6. اجرای برنامه / Run Application

```bash
# حالت توسعه
npm run dev

# حالت تولید
npm run build
npm start
```

سپس به [http://localhost:3000](http://localhost:3000) بروید.

---

## ماژول‌ها / Modules

### 1. داشبورد / Dashboard

**Route**: `/dashboard`

**ویژگی‌ها / Features**:
- نمایش خلاصه مالی (موجودی کل، مطالبات، بدهی‌ها)
- نمودار فروش روزانه و هفتگی
- هشدار موجودی کم
- وظایف کاربر
- فعالیت‌های اخیر
- دسترسی سریع به بخش‌های مختلف

**کامپوننت‌ها / Components**:
- `FinancialCards`: کارت‌های مالی
- `SalesChart`: نمودار فروش
- `LowStockAlert`: هشدار موجودی کم
- `MyTasksWidget`: ویجت وظایف
- `RecentActivity`: فعالیت‌های اخیر

---

### 2. مدیریت فروش / Sales Management

**Route**: `/dashboard/sales`

#### ویژگی‌ها / Features

- **POS (Point of Sale)**: صندوق فروش برای ثبت سفارشات
- **مدیریت مشتریان**: ثبت و مدیریت اطلاعات مشتریان
- **تاریخچه فروش**: مشاهده و جستجوی سفارشات قبلی
- **فاکتورها**: ایجاد و مدیریت فاکتورهای فروش
- **بازگشت و تعویض**: مدیریت بازگشت و تعویض کالا
- **پرداخت‌ها**: مدیریت پرداخت‌های مشتریان

#### مدل‌های دیتابیس / Database Models

- `Order`: سفارشات فروش
- `OrderItem`: آیتم‌های سفارش
- `Customer`: مشتریان
- `Invoice`: فاکتورها
- `OrderReturn`: بازگشت سفارشات
- `OrderExchange`: تعویض سفارشات

#### وضعیت‌های سفارش / Order Statuses

- `PENDING`: در انتظار
- `COMPLETED`: تکمیل شده
- `DELIVERED`: تحویل داده شده
- `CANCELLED`: لغو شده

#### وضعیت‌های پرداخت / Payment Statuses

- `PAID`: پرداخت شده
- `PARTIAL`: پرداخت جزئی
- `UNPAID`: پرداخت نشده
- `OVERDUE`: سررسید گذشته

---

### 3. مدیریت انبار / Inventory Management

**Route**: `/dashboard/inventory`

#### ویژگی‌ها / Features

- **تعریف کالا**: ثبت محصولات با انواع مختلف
- **مدیریت موجودی**: ردیابی موجودی در انبارهای مختلف
- **دارایی‌های ثابت**: مدیریت دارایی‌های ثابت و مصرفی
- **انبارها**: مدیریت چند انباره
- **گزارش‌های موجودی**: گزارش‌های مختلف موجودی
- **ممیزی انبار**: سیستم ممیزی کامل

#### مدل‌های دیتابیس / Database Models

- `Product`: محصولات
- `Inventory`: موجودی انبار
- `Warehouse`: انبارها
- `FixedAsset`: دارایی‌های ثابت
- `InventoryAudit`: ممیزی انبار
- `InventoryAuditItem`: آیتم‌های ممیزی

#### انواع محصولات / Product Types

- `SALEABLE`: محصول فروختنی
- `FIXED_ASSET`: دارایی ثابت
- `CONSUMABLE`: کالای مصرفی

#### انواع دارایی / Asset Types

- `FIXED`: دارایی ثابت
- `CONSUMABLE`: کالای مصرفی

---

### 4. خرید و تامین‌کنندگان / Purchase & Suppliers

**Route**: `/dashboard/suppliers`

#### ویژگی‌ها / Features

- **مدیریت تامین‌کنندگان**: ثبت و مدیریت اطلاعات تامین‌کنندگان
- **سفارشات خرید**: ثبت و مدیریت سفارشات خرید
- **گردش کار کامل**: از پیش‌نویس تا دریافت
- **مدیریت پرداخت‌ها**: ثبت پرداخت‌های سفارشات
- **هزینه‌های اضافی**: ثبت هزینه‌های حمل و نقل و گمرک
- **دریافت کالا**: ثبت دریافت کالاها و به‌روزرسانی خودکار موجودی

#### مدل‌های دیتابیس / Database Models

- `Supplier`: تامین‌کنندگان
- `PurchaseOrder`: سفارشات خرید
- `PurchaseOrderItem`: آیتم‌های سفارش خرید
- `PurchaseOrderAdditionalCost`: هزینه‌های اضافی سفارش
- `PurchaseOrderArrivalCost`: هزینه‌های رسیدن به مقصد

#### گردش کار سفارشات / Purchase Order Workflow

```
DRAFT → PENDING_PAYMENT → PAID → IN_PRODUCTION → ARRIVED → RECEIVED
```

#### ویژگی‌های پیشرفته / Advanced Features

- پشتیبانی از چند ارز (تومان، دلار، یورو، یوان)
- محاسبه خودکار نرخ تبدیل
- محاسبه قیمت تمام شده (Landed Cost)
- توزیع هزینه‌های اضافی بر اساس تعداد کل کالاها

---

### 5. حسابداری / Accounting

**Route**: `/dashboard/accounting`

#### ویژگی‌ها / Features

- **مدیریت حساب‌ها**: ایجاد و مدیریت حساب‌های بانکی و نقدی
- **ثبت درآمد**: ثبت درآمدها با پشتیبانی از چند ارز
- **ثبت هزینه**: ثبت هزینه‌ها با دسته‌بندی
- **نرخ ارز**: مدیریت نرخ‌های تبدیل ارز
- **گزارش‌های مالی**: گزارش‌های مختلف مالی
- **پیوست رسید**: آپلود و مدیریت رسیدهای فاکتور
- **کارمندان**: مدیریت کارمندان
- **حقوق و دستمزد**: مدیریت حقوق و دستمزد
- **وام‌ها**: مدیریت وام‌های کارمندان
- **سهامداران**: مدیریت سهامداران و توزیع سود

#### مدل‌های دیتابیس / Database Models

- `Account`: حساب‌ها
- `Transaction`: تراکنش‌های مالی
- `ExchangeRate`: نرخ‌های ارز
- `Employee`: کارمندان
- `Payroll`: حقوق و دستمزد
- `PayrollPayment`: پرداخت‌های حقوق
- `Loan`: وام‌ها
- `LoanPayment`: پرداخت‌های وام
- `Shareholder`: سهامداران
- `ShareholderProfit`: سود سهامداران
- `ShareholderWithdrawal`: برداشت‌های سهامداران

#### انواع تراکنش / Transaction Types

- `INCOME`: درآمد
- `EXPENSE`: هزینه
- `TRANSFER`: انتقال
- `ADJUSTMENT`: تعدیل

#### ارزهای پشتیبانی شده / Supported Currencies

- `TOMAN`: تومان
- `USD`: دلار
- `EUR`: یورو
- `CNY`: یوان

---

### 6. مدیریت پروژه / Project Management

**Route**: `/dashboard/projects`

#### ویژگی‌ها / Features

- **مدیریت پروژه‌ها**: ایجاد و مدیریت پروژه‌ها
- **مدیریت وظایف**: ایجاد و مدیریت وظایف با Kanban Board
- **Drag & Drop**: جابجایی وظایف بین ستون‌ها
- **اولویت‌بندی**: تعیین اولویت وظایف
- **ارجاع وظایف**: محول کردن وظایف به کاربران
- **بودجه پروژه**: مدیریت بودجه پروژه‌ها

#### مدل‌های دیتابیس / Database Models

- `Project`: پروژه‌ها
- `Task`: وظایف

#### وضعیت‌های پروژه / Project Statuses

- `ACTIVE`: فعال
- `COMPLETED`: تکمیل شده
- `ON_HOLD`: متوقف
- `CANCELLED`: لغو شده

#### وضعیت‌های وظیفه / Task Statuses

- `TODO`: برای انجام
- `IN_PROGRESS`: در حال انجام
- `REVIEW`: در حال بررسی
- `DONE`: انجام شده

#### اولویت‌های وظیفه / Task Priorities

- `LOW`: پایین
- `MEDIUM`: متوسط
- `HIGH`: بالا
- `URGENT`: فوری

---

### 7. CRM / Customer Relationship Management

**Route**: `/dashboard/crm`

#### ویژگی‌ها / Features

- **مدیریت مشتریان**: ثبت و مدیریت اطلاعات مشتریان
- **سرنخ‌ها (Leads)**: مدیریت سرنخ‌های فروش
- **فرصت‌های فروش (Deals)**: مدیریت فرصت‌های فروش با Kanban Board
- **پشتیبانی**: سیستم تیکتینگ برای پشتیبانی مشتریان
- **تبلیغات**: مدیریت کمپین‌های تبلیغاتی
- **360 درجه مشتری**: نمایش کامل اطلاعات مشتری

#### مدل‌های دیتابیس / Database Models

- `Customer`: مشتریان
- `Lead`: سرنخ‌ها
- `Deal`: فرصت‌های فروش
- `SupportTicket`: تیکت‌های پشتیبانی
- `Promotion`: تبلیغات

#### وضعیت‌های سرنخ / Lead Statuses

- `NEW`: جدید
- `CONTACTED`: تماس گرفته شده
- `QUALIFIED`: واجد شرایط
- `CONVERTED`: تبدیل شده
- `LOST`: از دست رفته

#### مراحل فرصت‌های فروش / Deal Stages

- `PROSPECT`: پیشنهاد
- `QUALIFICATION`: واجد شرایط
- `PROPOSAL`: پیشنهاد
- `NEGOTIATION`: مذاکره
- `CLOSED_WON`: بسته موفق
- `CLOSED_LOST`: بسته ناموفق

---

### 8. مدیریت امانی / Consignment Management

**Route**: `/dashboard/consignment`

#### ویژگی‌ها / Features

- **همکاران**: مدیریت همکاران امانی
- **انتقال کالا**: انتقال موجودی به انبارهای مجازی همکاران
- **تسویه حساب**: مدیریت تسویه حساب با همکاران
- **انبارهای مجازی**: ایجاد انبارهای مجازی برای همکاران

#### مدل‌های دیتابیس / Database Models

- `ConsignmentPartner`: همکاران امانی
- `ConsignmentTransfer`: انتقال‌های امانی
- `ConsignmentSettlement`: تسویه‌حساب‌ها

---

### 9. بازاریابی / Marketing

**Route**: `/dashboard/marketing`

#### ویژگی‌ها / Features

- **کمپین‌های بازاریابی**: مدیریت کمپین‌های تبلیغاتی
- **هدایای بازاریابی**: ثبت و مدیریت هدایای بازاریابی

#### مدل‌های دیتابیس / Database Models

- `MarketingCampaign`: کمپین‌های بازاریابی
- `MarketingGift`: هدایای بازاریابی
- `Promotion`: تبلیغات

---

### 10. یکپارچه‌سازی WooCommerce / WooCommerce Integration

**Route**: `/dashboard/woocommerce`

#### ویژگی‌ها / Features

- **همگام‌سازی محصولات**: همگام‌سازی محصولات از WooCommerce
- **همگام‌سازی سفارشات**: همگام‌سازی سفارشات از WooCommerce
- **مدیریت اتصال**: مدیریت تنظیمات اتصال به WooCommerce

#### تنظیمات / Configuration

1. به `/dashboard/settings` بروید
2. بخش "تنظیمات WooCommerce" را پیدا کنید
3. اطلاعات زیر را وارد کنید:
   - URL فروشگاه WooCommerce
   - Consumer Key
   - Consumer Secret
   - انبار پیش‌فرض برای محصولات

---

### 11. دستیار هوش مصنوعی / AI Assistant

**Route**: `/dashboard/assistant`

#### ویژگی‌ها / Features

- **چت‌بات هوشمند**: گفتگوی متنی با دستیار AI
- **خواندن اطلاعات**: دستیار می‌تواند اطلاعات سیستم را بخواند
- **انجام عملیات**: دستیار می‌تواند عملیات‌هایی انجام دهد (مثلاً ایجاد مشتری، ثبت هزینه)
- **پشتیبانی از چند Provider**: OpenAI, Anthropic, Gemini, Groq

#### تنظیمات / Configuration

1. به `/dashboard/assistant` بروید
2. در بخش "تنظیمات AI" کلیک کنید
3. ارائه‌دهنده و API Key را انتخاب کنید
4. مدل مورد نظر را انتخاب کنید

برای اطلاعات بیشتر، به [AI_ASSISTANT_GUIDE.md](./AI_ASSISTANT_GUIDE.md) مراجعه کنید.

#### ابزارهای در دسترس / Available Tools

- `get_inventory_summary`: خلاصه موجودی انبار
- `get_sales_summary`: خلاصه فروش
- `get_customer_info`: اطلاعات مشتری
- `search_products`: جستجوی محصولات
- `get_financial_summary`: خلاصه مالی
- `create_customer`: ایجاد مشتری
- `record_expense`: ثبت هزینه

---

### 12. گزارش‌گیری / Reporting

**Route**: `/dashboard/reports`, `/dashboard/reporting`

#### ویژگی‌ها / Features

- **گزارش‌های فروش**: گزارش‌های مختلف فروش
- **گزارش‌های مالی**: گزارش‌های مالی و حسابداری
- **گزارش‌های موجودی**: گزارش‌های موجودی و انبار
- **گزارش‌های پروژه**: گزارش‌های پروژه و وظایف
- **خروجی Excel**: امکان خروجی گرفتن گزارش‌ها به Excel

---

### 13. تنظیمات / Settings

**Route**: `/dashboard/settings`

#### ویژگی‌ها / Features

- **مدیریت کاربران**: ایجاد و مدیریت کاربران سیستم
- **نقش‌ها و دسترسی‌ها**: مدیریت نقش‌ها و دسترسی‌ها
- **تنظیمات شرکت**: اطلاعات شرکت
- **تنظیمات WooCommerce**: اتصال به WooCommerce
- **تنظیمات AI**: تنظیمات دستیار هوش مصنوعی
- **بک‌آپ**: پشتیبان‌گیری از دیتابیس

#### نقش‌های سیستم / System Roles

- `ADMIN`: مدیر سیستم
- `ACCOUNTANT`: حسابدار
- `WAREHOUSE`: انباردار
- `SALES`: فروشنده
- `PROJECT_MANAGER`: مدیر پروژه
- `USER`: کاربر عادی

---

## API و Server Actions

### Server Actions

تمام عملیات دیتابیس از طریق Server Actions انجام می‌شود:

- `actions/accounting.ts`: عملیات حسابداری
- `actions/sales.ts`: عملیات فروش
- `actions/inventory.ts`: عملیات انبار
- `actions/supplier.ts`: عملیات خرید
- `actions/project.ts`: عملیات پروژه
- `actions/crm.ts`: عملیات CRM
- `actions/ai-chat.ts`: عملیات دستیار AI
- و سایر ماژول‌ها

### API Routes

- `/api/auth/[...nextauth]`: احراز هویت NextAuth
- `/api/backups/[filename]`: دانلود فایل‌های بک‌آپ
- `/api/products/[id]`: اطلاعات محصول
- `/api/warehouses/[id]`: اطلاعات انبار

---

## امنیت / Security

### احراز هویت / Authentication

- **NextAuth.js**: مدیریت احراز هویت و نشست‌ها
- **bcrypt**: رمزگذاری رمز عبور
- **Session Management**: مدیریت نشست‌های کاربر
- **Password Reset**: سیستم بازیابی رمز عبور

### دسترسی‌ها / Access Control

- **Role-Based Access Control (RBAC)**: کنترل دسترسی بر اساس نقش
- **Middleware Protection**: محافظت از مسیرها با Middleware
- **Server-Side Validation**: اعتبارسنجی داده‌ها در سمت سرور

### امنیت داده‌ها / Data Security

- **Prisma ORM**: جلوگیری از SQL Injection
- **Zod Validation**: اعتبارسنجی ورودی‌ها
- **File Upload Security**: مدیریت امن فایل‌ها

---

## توسعه / Development

### ساختار کد / Code Structure

- **TypeScript**: Type Safety
- **ESLint**: بررسی کد
- **Prettier**: فرمت کد
- **نام‌گذاری فارسی**: برای متغیرهای UI

### استانداردهای کدنویسی / Coding Standards

- استفاده از TypeScript برای type safety
- استفاده از Server Components تا جای ممکن
- استفاده از Server Actions برای عملیات دیتابیس
- استفاده از Zod برای validation
- نام‌گذاری واضح و توصیفی

### تست / Testing

- تست دستی برای ماژول‌های اصلی
- اعتبارسنجی داده‌ها
- تست امنیت

---

## استقرار / Deployment

### پیش‌نیازها / Prerequisites

- Node.js >= 18.17.0
- PostgreSQL >= 12
- Environment Variables

### مراحل استقرار / Deployment Steps

1. **Build**: `npm run build`
2. **Start**: `npm start`
3. **Environment Variables**: تنظیم متغیرهای محیط در production
4. **Database**: اطمینان از دسترسی به دیتابیس
5. **Migrations**: اجرای migrations در production

### استقرار روی Vercel / Deploy to Vercel

1. Push به GitHub
2. Import project در Vercel
3. تنظیم Environment Variables
4. Deploy

---

## پشتیبانی / Support

برای سوالات و پشتیبانی، لطفاً issue در GitHub باز کنید.

For questions and support, please open an issue on GitHub.

---

**نسخه مستندات / Documentation Version**: 1.0  
**آخرین به‌روزرسانی / Last Updated**: ۱۴۰۳/۱۰/۰۳

