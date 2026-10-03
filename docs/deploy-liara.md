# انتقال ERP به لیارا (erp.themoak.com)

این راهنما قدم‌به‌قدم ERP را از Vercel و Prisma Postgres به لیارا می‌برد: برنامه روی پلتفرم NextJS لیارا و دیتابیس روی PostgreSQL لیارا.
تا وقتی DNS عوض نشده، Vercel دست نمی‌خورد و ERP فعلی کار می‌کند.

> **قبل از هر کاری:** هیچ‌کدام از این مرحله‌ها خودکار نیست. ساختن منابع در لیارا، پرداخت پلن‌ها و عوض کردن DNS کار خود شماست.
> هر جا نوشته «بررسی کنید»، یعنی مستندات لیارا آن را نگفته‌اند و باید بعد از اولین استقرار خودتان ببینید.

## آنچه در کد آماده شده

- **`liara.json`**: پلتفرم `next`، پورت 3000، Node 22، build در آلمان، بدون health check (پایین‌تر را ببینید) و cronها. cronها همان دو cron فایل `vercel.json` هستند، با همان ساعت‌ها.
- **`next.config.js`**: باید با همین نام بماند (نه `.mjs` یا `.ts`).
  - لیارا فقط دنبال `next.config.js` می‌گردد. اگر پیدایش نکند، خودش یک فایل تازه فقط با `output: 'standalone'` می‌سازد. Next.js آن فایل را زودتر از `.mjs` می‌خواند، پس تنظیمات ما (سقف ۵ مگابایت آپلود رسید و عکس‌های themoak.com) کنار گذاشته می‌شد.
  - خروجی `standalone` است. ایمیج اجرای لیارا فقط پوشه‌ی `.next/standalone` را دارد (به‌علاوه‌ی `.next/static` و `public`).
- **هم‌سان‌سازی دیتابیس هنگام روشن شدن برنامه:**
  - build لیارا روی سرورهای خود لیارا اجرا می‌شود و به شبکه‌ی خصوصی دیتابیس دسترسی ندارد. برای همین روی لیارا `npm run build` دیگر به دیتابیس دست نمی‌زند.
  - به‌جایش هر بار که سرور روشن می‌شود و قبل از اینکه به اولین درخواست جواب بدهد، `scripts/db-deploy.mjs` اجرا می‌شود (`src/instrumentation.ts`).
  - این اسکریپت همان قدم‌های build در Vercel را انجام می‌دهد: SQL پیش از push، `prisma db push` و backfillها.
  - اگر دو نسخه با هم روشن شوند، با یک قفل دیتابیس (advisory lock) نوبتی اجرا می‌شوند.
  - اگر یکی از قدم‌ها شکست بخورد، سرور اصلاً بالا نمی‌آید و لیارا نسخه‌ی قبلی را روشن نگه می‌دارد.
- **ساعت سرور:** کد ERP برای سرور UTC نوشته شده (مثل Vercel)، ولی منطقه‌ی زمانی پیش‌فرض لیارا Asia/Tehran است. سرور هنگام روشن شدن ساعت را روی UTC می‌گذارد. `TZ=UTC` را هم در متغیرها بگذارید.
- **فونت‌ها** (وزیرمتن و Space Mono) داخل کد هستند (`src/app/fonts` با مجوز OFL)، پس build دیگر از Google Fonts چیزی دانلود نمی‌کند. فایل‌ها همان فایل‌های Google Fonts هستند و ظاهر عوض نمی‌شود.
- **کلید `APP_ENV=production`:** این کلید سه کار می‌کند:
  - ارسال موجودی به سایت را روشن می‌کند (در Vercel این کار را `VERCEL_ENV` می‌کرد).
  - جلوی ذخیره‌ی رسید یا عکس روی دیسک خود سرور را می‌گیرد، وقتی FTP تنظیم نشده.
  - هم‌سان‌سازی دیتابیس را هنگام روشن شدن سرور فعال می‌کند.
- **دستیار هوش مصنوعی:** اگر سرویس هوش مصنوعی از سرور ایران در دسترس نباشد یا ایران را نپذیرد، پیام فارسی روشن نشان می‌دهد و بقیه‌ی صفحه‌ها کار می‌کنند.

## ۰. پیش‌نیازها روی مک شما

```bash
# Node arm64 (همان که تست‌ها با آن اجرا می‌شوند)
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:/usr/local/opt/postgresql@17/bin:$PATH"
node -v          # v22.x
psql --version   # 17.x

# Liara CLI
npm install -g @liara/cli
liara login
```

یک زمان تعمیرات اعلام کنید. از لحظه‌ی گرفتن پشتیبان در مرحله‌ی ۳ تا عوض شدن DNS در مرحله‌ی ۶، کسی در ERP قدیمی چیزی ثبت نکند. هر چیزی که در این فاصله ثبت شود، به لیارا نمی‌رسد.

## ۱. ساختن شبکه، دیتابیس و برنامه در لیارا

### ۱-۱. شبکه‌ی خصوصی
- یک شبکه‌ی خصوصی بسازید، مثلاً `themoak-net`.
- دیتابیس و برنامه **هر دو** باید روی همین شبکه باشند.
- شبکه را بعداً نمی‌شود عوض کرد. برای دیتابیس، عوض کردن شبکه یعنی ساختن دیتابیس تازه و بازگرداندن بک‌آپ.
- مستند: https://docs.liara.ir/paas/details/private-network/

### ۱-۲. دیتابیس PostgreSQL
- **نسخه: 17.** تست‌های ERP روی PostgreSQL 17 اجرا می‌شوند. نسخه را بعد از ساختن نمی‌شود عوض کرد (https://docs.liara.ir/dbaas/postgresql/choose-version/).
- **بسته‌ی امکانات: نقره‌ای یا بالاتر.**
  - بسته‌ی برنزی هیچ پشتیبان خودکار یا دستی ندارد.
  - بسته‌ی نقره‌ای پشتیبان خودکار روزانه دارد، که ۷ روز نگه داشته می‌شود، و پشتیبان دستی.
  - مستند: https://docs.liara.ir/dbaas/details/plans/software-plans/
- **پلن سخت‌افزاری:** کوچک‌ترین پلنی که حجم دیتابیس فعلی را جا دهد کافی است. دیتابیس ERP کوچک است.
- **شبکه:** `themoak-net`.
- **دسترسی از شبکه‌ی عمومی:** برای مرحله‌ی ۳ موقتاً روشنش کنید و بعد از انتقال خاموشش کنید (https://docs.liara.ir/dbaas/postgresql/how-tos/connect-via-cli/psql/).

بعد از ساخته شدن، دو آدرس اتصال در پنل هست:
- **آدرس شبکه‌ی خصوصی**، که میزبانش شناسه‌ی دیتابیس است، مثلاً `postgresql://root:...@<db-id>:5432/postgres`. برنامه از این استفاده می‌کند.
- **آدرس شبکه‌ی عمومی**، با میزبان `*.liara.cloud` و یک پورت. شما از مک با این وصل می‌شوید.

یک دیتابیس جدا برای ERP بسازید. لیارا هم توصیه می‌کند از `postgres` پیش‌فرض استفاده نشود.

```bash
# آدرس عمومی که در پنل است، با دیتابیس postgres:
export LIARA_ADMIN_URL='postgresql://root:<password>@<public-host>:<public-port>/postgres'
psql "$LIARA_ADMIN_URL" -c "CREATE DATABASE themoak_erp WITH TEMPLATE template0 ENCODING 'UTF8';"
# آیا root ابرکاربر است؟ (بازگرداندن پشتیبان ERP این را لازم دارد؛ بخش ۳-۳)
psql "$LIARA_ADMIN_URL" -Atc "SELECT rolsuper FROM pg_roles WHERE rolname = current_user;"   # باید t باشد
```

از این به بعد:

```bash
export LIARA_DB_URL='postgresql://root:<password>@<public-host>:<public-port>/themoak_erp'   # از مک
# و برای برنامه (متغیر DATABASE_URL در لیارا):
#   postgresql://root:<password>@<db-id>:5432/themoak_erp                              # شبکه‌ی خصوصی
```

### ۱-۳. برنامه
- **پلتفرم: NextJS.**
- **نام:** مثلاً `themoak-erp`. همین نام را در `liara.json` جای `REPLACE-WITH-LIARA-APP-NAME` بگذارید، یا موقع استقرار با `--app` بدهید.
- **بسته‌ی امکانات: نقره‌ای یا بالاتر.**
  - استقرار بدون قطعی (zero-downtime) در بسته‌ی برنزی نیست.
  - سقف زمان build در برنزی ۵ دقیقه و در نقره‌ای ۱۰ دقیقه است.
  - build در آلمان در هر سه بسته هست.
  - مستند: https://docs.liara.ir/paas/details/plans/software-plans/
- **پلن سخت‌افزاری:** «مریخ» (۱ گیگ RAM) کافی است. در اجرای آزمایشی محلی، سرور بعد از باز کردن ۱۰۸ صفحه حدود ۲۴۰ مگابایت حافظه مصرف کرد. هنگام روشن شدن، CLI پریزما برای هم‌سان‌سازی دیتابیس چند ثانیه در یک پروسه‌ی جدا اجرا می‌شود و تا تمام شدنش حافظه‌ی بیشتری لازم است (این مقدار اندازه‌گیری نشده است). اگر حافظه کم آمد، «مشتری» (۲ گیگ) را بگیرید.
- **شبکه:** `themoak-net`.
- **دیسک:** لازم نیست. رسیدها، عکس کالاها و پشتیبان‌ها روی FTP خود شما می‌روند، نه روی دیسک لیارا.
  - فایل‌سیستم برنامه‌ی Next در لیارا نوشتنی است، ولی با هر ری‌استارت یا استقرار پاک می‌شود (https://docs.liara.ir/paas/details/file-system/).
  - برای همین با `APP_ENV=production`، ERP بدون FTP هیچ فایلی را روی دیسک خودش نگه نمی‌دارد.

## ۲. متغیرهای محیطی

در پنل برنامه، در «تنظیمات ← متغیرهای محیطی»، یا با `liara env set ... -a themoak-erp`، **قبل از اولین استقرار** این‌ها را بگذارید.
متغیرهای پنل در زمان build هم دیده می‌شوند (https://docs.liara.ir/paas/nextjs/how-tos/set-envs/). این مهم است، چون `APP_ENV` باید در build هم باشد.

> فیلد `envs` را در `liara.json` نگذارید: طبق مستندات، همه‌ی متغیرهای قبلی را پاک می‌کند (https://docs.liara.ir/paas/liarajson/).

| متغیر | مقدار از کجا می‌آید | توضیح |
|---|---|---|
| `DATABASE_URL` | آدرس **شبکه‌ی خصوصی** دیتابیس از پنل، با دیتابیس `themoak_erp` | `connection_limit=1` اضافه نکنید |
| `APP_ENV` | دقیقاً `production` | بدون آن build سعی می‌کند به دیتابیس وصل شود و شکست می‌خورد |
| `TZ` | دقیقاً `UTC` | |
| `AUTH_SECRET` | **همان** مقدار Vercel (Project → Settings → Environment Variables). اگر قابل خواندن نیست: `openssl rand -base64 32` | با مقدار تازه همه یک بار باید دوباره وارد شوند |
| `AUTH_URL` | `https://erp.themoak.com` | لینک‌های فراموشی رمز از این ساخته می‌شوند |
| `AUTH_TRUST_HOST` | `true` | |
| `CRON_SECRET` | همان مقدار Vercel، یا تازه با `openssl rand -base64 32` | cronهای لیارا و هر زمان‌بندِ بیرونی که `/api/site/hook-flush` را صدا می‌زند، همین را می‌فرستند |
| `ERP_API_SECRET` | همان مقدار Vercel | کلید ابزارهای Claude (mcp-server). باید با تنظیمات Claude روی مک یکی باشد |
| `ERP_SITE_API_SECRET` | همان مقدار Vercel | کلید سایت. باید با مقداری که سایت themoak.com می‌فرستد یکی باشد |
| `SMTP_HOST` | همان مقدار Vercel (مثلاً `mail.themoak.com`) | برای ایمیل فراموشی رمز |
| `SMTP_PORT` | همان (معمولاً `465`) | |
| `SMTP_USER` | همان | |
| `SMTP_PASSWORD` | همان | |
| `SMTP_FROM` | همان | |
| `APP_COMMIT_SHA` | اختیاری: خروجی `git rev-parse HEAD` نسخه‌ای که مستقر می‌کنید | فقط در سرِ فایل‌های پشتیبان نوشته می‌شود |
| `NEXT_TELEMETRY_DISABLED` | اختیاری: `1` | |

این‌ها را **نگذارید**: `VERCEL`، `VERCEL_ENV`، `VERCEL_GIT_COMMIT_SHA`، `NODE_ENV`. `ERP_API_URL` هم مال سرور نیست؛ فقط روی مک شما برای mcp-server است.

اگر متغیری در Vercel «Sensitive» علامت خورده باشد، مقدارش دیگر خوانده نمی‌شود. آن‌وقت:
- `CRON_SECRET` و `AUTH_SECRET` را تازه بسازید.
- `ERP_SITE_API_SECRET` را از تنظیمات سایت بردارید.
- `ERP_API_SECRET` را از تنظیمات Claude روی مک بردارید (`scripts/install-claude.sh` آن را آنجا گذاشته).

## ۳. انتقال داده‌ها

### ۳-۱. یک پشتیبان تازه از ERP قدیمی
1. در ERP قدیمی، «تنظیمات ← پشتیبان‌گیری ← ایجاد بک‌آپ جدید» را بزنید. پشتیبان روی FTP ذخیره می‌شود.
2. همان پشتیبان را با دکمه‌ی «دانلود» بگیرید، مثلاً `~/Downloads/backup-2026-10-05T08-00-00.sql`.
3. خط دوم فایل را ببینید:

```bash
export BACKUP=~/Downloads/backup-2026-10-05T08-00-00.sql   # نام فایل خودتان
sed -n 2p "$BACKUP"
# -- Taken: 2026-10-05T08:00:00.000Z   Code: <commit>
```

`<commit>` نسخه‌ی کدی است که پشتیبان با آن گرفته شده. جدول‌ها باید اول با **همان** نسخه ساخته شوند.
اگر خط Code ندارد، commit استقرار Production را از داشبورد Vercel بردارید (Deployments ← Production).

### ۳-۲. ساختن جدول‌ها با کد همان پشتیبان

```bash
cd ~/dev/themoak-erp-new
export OLD=<commit از خط Code>
git fetch origin && git worktree add /tmp/erp-old "$OLD"

# CLI پریزمای همین مخزن (نه npx در پوشه‌ی تازه، که یک Prisma دیگر دانلود می‌کند):
DATABASE_URL="$LIARA_DB_URL" npx prisma db push --schema /tmp/erp-old/prisma/schema.prisma --skip-generate
```

### ۳-۳. بازگرداندن ردیف‌ها با psql

```bash
psql "$LIARA_DB_URL" -v ON_ERROR_STOP=1 -f "$BACKUP"
```

فایل پشتیبان موقع ریختن ردیف‌ها، چک کلیدهای خارجی را با `session_replication_role = replica` خاموش می‌کند. این کار ابرکاربر لازم دارد؛ بخش ۱-۲ را ببینید.

اگر `root` ابرکاربر نبود و این دستور با `permission denied to set parameter "session_replication_role"` متوقف شد، این راه را بروید:
1. پشتیبان را در Postgres محلی خودتان بازگردانید.
2. قدم‌های ۳-۴ را آنجا اجرا کنید.
3. نتیجه را با `pg_dump`/`pg_restore` به لیارا ببرید. pg_restore ابرکاربر لازم ندارد.

```bash
createdb -h ~/dev/erp-recovery -p 55433 -U postgres erp_cutover
export LOCAL_URL='postgresql://postgres@localhost:55433/erp_cutover?host=/Users/pooyanmokri/dev/erp-recovery'
DATABASE_URL="$LOCAL_URL" npx prisma db push --schema /tmp/erp-old/prisma/schema.prisma --skip-generate
psql "$LOCAL_URL" -v ON_ERROR_STOP=1 -f "$BACKUP"
# ... قدم‌های ۳-۴ با DATABASE_URL="$LOCAL_URL" ...
pg_dump "$LOCAL_URL" -Fc --no-owner --no-acl -f /tmp/erp_cutover.dump
psql "$LIARA_ADMIN_URL" -c "DROP DATABASE themoak_erp;" -c "CREATE DATABASE themoak_erp WITH TEMPLATE template0 ENCODING 'UTF8';"
pg_restore --no-owner --no-acl -d "$LIARA_DB_URL" /tmp/erp_cutover.dump
```

### ۳-۴. ارتقا به کد جدید و اصلاح داده‌ها (دقیقاً به همین ترتیب)

این قدم‌ها از پوشه‌ی کدی اجرا می‌شوند که می‌خواهید مستقر کنید:

```bash
cd ~/dev/erp-wt-liara          # یا worktree همان commit که مستقر می‌کنید
export DATABASE_URL="$LIARA_DB_URL"

# ۱) SQL پیش از push (ستون‌ها، جدول‌ها و triggerهای ارسال موجودی به سایت)
npx prisma db execute --schema ./prisma/schema.prisma --file ./prisma/sql/pre-push-unique-columns.sql

# ۲) جدول‌ها و ستون‌های کد جدید
npx prisma db push --skip-generate

# ۳) backfillها، به ترتیب build
npx prisma db execute --schema ./prisma/schema.prisma --file ./prisma/sql/backfill-purchase-payments.sql
npx prisma db execute --schema ./prisma/schema.prisma --file ./prisma/sql/backfill-order-money.sql
npx prisma db execute --schema ./prisma/schema.prisma --file ./prisma/sql/backfill-consignment-channels.sql
npx prisma db execute --schema ./prisma/schema.prisma --file ./prisma/sql/backfill-order-exchange-items.sql

# ۴) اصلاح داده‌های ۱۴۰۵/۰۷/۰۹ (یک تراکنش؛ اگر داده آن‌طور که گفته بودید نباشد، کل اجرا برمی‌گردد)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/sql/datafix-2026-10-01-ALL.sql

# ۵) بستن سفارش خرید #4 با کسری (بعد از ۴، چون پرداخت #4 را ۴ ثبت می‌کند)
npx tsx scripts/datafix-2026-10-01-close-po4-short.ts

unset DATABASE_URL
```

- `npx prisma db push` اگر ببیند داده‌ای پاک می‌شود، **رد می‌کند** و هیچ کاری نمی‌کند. در این حالت جلوتر نروید و پیام را برای من بفرستید.
- قدم‌های ۱ تا ۳ را سرور در هر بار روشن شدن هم اجرا می‌کند (`npm run db:deploy` همان است). دوباره اجرا شدنشان چیزی را عوض نمی‌کند. اصلاح داده‌ها (۴ و ۵) فقط همین یک بار و دستی است.

## ۴. استقرار با Liara CLI

از یک worktree تمیز مستقر کنید، تا فقط کد commit‌شده بالا برود. `.local/` و فایل‌های دیگری که روی مک دارید بالا نمی‌روند.

```bash
cd ~/dev/themoak-erp-new
git worktree add ~/dev/erp-deploy liara/prep        # یا commitی که تأیید کرده‌اید
cd ~/dev/erp-deploy
liara deploy --app themoak-erp --message "$(git rev-parse --short HEAD)"
```

- لیارا این کارها را می‌کند:
  1. `npm install` (یا `npm ci`)
  2. `npm run build`؛ چون `APP_ENV=production` است، build به دیتابیس دست نمی‌زند.
  3. `postbuild`، که بررسی می‌کند CLI پریزما و فایل‌های SQL داخل خروجی standalone باشند. اگر نباشند، build همین‌جا شکست می‌خورد.
- بعد سرور روشن می‌شود. در لاگ برنامه (`liara logs -a themoak-erp -f`) باید به این ترتیب ببینید:
  1. `[db:deploy] lock taken`
  2. قدم‌ها
  3. `[db:deploy] done in ...s`
  4. `Ready`
- **اگر لاگ build در `npm ci` ساکت ماند و به سقف زمان خورد:** یک بار `liara deploy --no-cache` بزنید.
- **اگر mirror npm لیارا گیر کرد:** در `liara.json`، `"next": {"mirror": false}` بگذارید. این را بقیه‌ی کاربران لیارا هم گزارش کرده‌اند.
- **health check فعلاً نیست.** زمان‌ها میلی‌ثانیه‌اند (`liara init` می‌پرسد «interval(ms)») و لیارا `timeout` بیشتر از ۱۰۰۰۰ و `startPeriod` بیشتر از ۳۰۰۰ را رد می‌کند. با `interval: 30000`، `timeout: 10000`، `retries: 3`، `startPeriod: 3000` و فرمان `["CMD","curl","--fail",…,"http://localhost:3000/api/health"]`، لیارا نسخه‌ی v3 را حدود ۹۰ ثانیه بعد از شروع بست. این در حالی بود که `db:deploy` در ۱۷ ثانیه تمام شده بود و یک cron با curl همان لحظه از localhost:3000 جواب گرفته بود. پس لیارا فرمان را جور دیگری اجرا می‌کند. قبل از برگرداندنش، داخل کانتینرِ در حال اجرا با `liara shell -a themoak-erp -c "…"` امتحانش کنید. `/api/health` سر جایش هست.

### بعد از اولین استقرار بررسی کنید
این‌ها در مستندات لیارا نیامده‌اند:

```bash
liara shell -a themoak-erp
cat /etc/os-release; openssl version; node -v; echo "$TZ"; ls /app
```

- `node -v` باید 22 باشد.
- اگر سیستم‌عامل Debian یا Ubuntu با OpenSSL 3 است، `binaryTargets` در `prisma/schema.prisma` (`debian-openssl-3.0.x`) درست است.
- اگر خطای «Prisma Client could not locate the Query Engine» دیدید، خروجی همین دستورها را بفرستید.

## ۵. بررسی بعد از استقرار (قبل از عوض کردن DNS)

با آدرس موقت لیارا، مثلاً `https://themoak-erp.liara.run`:

- [ ] **ورود:** با حساب ادمین از فرم ورود وارد شوید. داشبورد و چند صفحه را باز کنید و ببینید اعداد با ERP قدیمی یکی است.
  - ورود با آدرس `liara.run` کار می‌کند، چون `AUTH_TRUST_HOST` و `trustHost` روشن‌اند.
  - لینک فراموشی رمز تا عوض شدن DNS به `erp.themoak.com` اشاره می‌کند.
- [ ] **فروش:** یک فروش آزمایشی در POS ثبت کنید، بعد آن را برگشت یا حذف کنید، همان‌طور که در ERP قدیمی می‌کردید. موجودی و حساب را ببینید.
- [ ] **رسید روی FTP:**
  1. به تراکنش یک رسید عکس بدهید. باید روی FTP (Limoo، 31.214.255.152) برود.
  2. رسید را باز کنید.
  3. رسید را حذف کنید.
  - اگر وصل نشد: «تنظیمات ← FTP ← تست اتصال».
  - لیارا در ایران است و هاست FTP هم در ایران است، پس مشکل قبلیِ IPهای خارجی نباید پیش بیاید.
- [ ] **پشتیبان دستی:** «تنظیمات ← پشتیبان‌گیری ← ایجاد بک‌آپ جدید»، بعد «دانلود». فایل باید روی FTP در `/backups` باشد.
- [ ] **cronها:**
  - در «تنظیمات برنامه» در پنل لیارا، دو cron باید دیده شوند (https://docs.liara.ir/paas/nextjs/how-tos/set-cron-job/).
  - برای امتحان دستی، همان دستور cron را در `liara shell` اجرا کنید:

    ```bash
    curl --fail --silent --show-error -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/backup
    ```

    - جواب `{"ok":true,"backup":"backup-..."}` یعنی پشتیبان گرفته شد. این وقتی است که زمان‌بندی پشتیبان در تنظیمات روشن است و امروز هنوز پشتیبانی گرفته نشده.
    - جواب `{"ok":true,"skipped":true}` یعنی امروز لازم نبود.
    - جواب `401` یعنی `CRON_SECRET` به دستور نرسیده.
  - فردا صبح در صفحه‌ی پشتیبان‌گیری ببینید «آخرین بک‌آپ» عوض شده باشد.
  - مستندات لیارا نمی‌گویند cron با کدام منطقه‌ی زمانی اجرا می‌شود (UTC یا تهران) و آیا متغیرهای محیطی به آن می‌رسند. نتیجه‌ی فردا همین را نشان می‌دهد.
  - ساعت اجرا مهم نیست، چون ERP روز را با تقویم تهران می‌شمارد و روزی یک پشتیبان می‌گیرد. اگر دو نسخه هم‌زمان چک کنند، فقط یکی پشتیبان می‌گیرد.
- [ ] **ارسال موجودی به سایت:**
  1. در «تنظیمات ← سایت»، «امتحان اتصال» را بزنید.
  2. موجودی یک کالای دارای webId را عوض کنید. در سایت ببینید چند ثانیه بعد عوض شده.
  - با `APP_ENV=production` این ارسال روی لیارا روشن است.
  - همگام‌سازی عکس‌ها از سایت هر شب با cron اجرا می‌شود.
- [ ] **دستیار هوش مصنوعی:** یک سؤال بپرسید.
  - اگر سرویس از ایران در دسترس نباشد، پیام فارسی «سرور ERP به سرویس … وصل نشد … ممکن است این سرویس از سرور ERP (ایران) مسدود باشد» می‌آید.
  - اگر سرویس ایران را نپذیرد، پیام «… احتمالاً این سرویس به سرورهای ایران خدمات نمی‌دهد» می‌آید.
  - بقیه‌ی ERP کار می‌کند. بخش «خطرها» را ببینید.
- [ ] **ایمیل فراموشی رمز:** برای خودتان امتحان کنید. بعضی دیتاسنترها پورت‌های SMTP را می‌بندند؛ مستندات لیارا چیزی درباره‌اش نمی‌گویند.

## ۶. وصل کردن erp.themoak.com در Cloudflare

1. **قبل از هر کاری،** رکورد فعلی `erp` در Cloudflare را یادداشت کنید (نوع، مقدار، وضعیت پروکسی). برای بازگشت لازم است.
2. **در لیارا:** «برنامه ← دامنه‌ها ← افزودن دامنه ← `erp.themoak.com`» (https://docs.liara.ir/paas/domains/add-domain/). لیارا سه رکورد می‌دهد:
   - یک `CNAME` برای `erp`
   - یک `TXT` برای اثبات مالکیت
   - یک `CNAME` برای `_acme-challenge.erp`، که گواهی SSL با آن صادر و تمدید می‌شود
3. **در Cloudflare:** اول `TXT` و `_acme-challenge` را اضافه کنید.
   - رکورد `_acme-challenge` باید **DNS only** (ابر خاکستری) باشد.
   - در لیارا «بررسی وضعیت رکوردها» را بزنید و SSL را فعال کنید (https://docs.liara.ir/paas/domains/enable-ssl/).
   - تا اینجا ERP قدیمی هنوز سر جایش است.
4. **عوض کردن (لحظه‌ی جابه‌جایی):** رکورد `erp` را به `CNAME` لیارا عوض کنید.
   - **پیشنهاد من: DNS only (ابر خاکستری).**
   - کاربران ERP در ایران‌اند و سرور هم در ایران است. با پروکسی Cloudflare هر درخواست اول به خارج از ایران می‌رود و برمی‌گردد.
   - گواهی را خود لیارا می‌دهد.
5. **اگر پروکسی Cloudflare (ابر نارنجی) را می‌خواهید:** مستندات لیارا اینجا با هم نمی‌خوانند.
   - صفحه‌ی دامنه می‌گوید SSL کلودفلر را روی «Flexible» بگذارید.
   - صفحه‌ی CDN، حالت «SSL لیارا روشن و SSL CDN روشن» را امن‌ترین می‌داند (https://docs.liara.ir/paas/domains/use-cdn/).
   - حالت SSL کلودفلر برای کل `themoak.com` است و روی سایت هم اثر دارد. پس آن را برای همه عوض نکنید. با یک «Configuration Rule» فقط برای `erp.themoak.com` حالت `Full (strict)` بگذارید.
   - خطای 502 یعنی تنظیم SSL دو طرف با هم نمی‌خواند.
6. بعد از چند دقیقه، `https://erp.themoak.com` را باز کنید و چک‌لیست مرحله‌ی ۵ را یک بار دیگر سریع اجرا کنید.

## ۷. سایت themoak.com

- آدرس API ERP در سایت **همان `https://erp.themoak.com` می‌ماند** و در سایت چیزی عوض نمی‌شود.
- کلید `ERP_SITE_API_SECRET` در لیارا باید همان کلیدی باشد که سایت می‌فرستد.
- آدرس سایت و رمز وبهوک ERP در دیتابیس ERP هستند و با پشتیبان منتقل شده‌اند («تنظیمات ← سایت»).
- اگر یک زمان‌بند بیرونی (مثل cron-job.org) `/api/site/hook-flush` را صدا می‌زند، کار می‌کند. شرطش این است که `CRON_SECRET` همان قبلی مانده باشد.
- اگر زمان‌بند بیرونی ندارید و می‌خواهید لیارا هر ۲ دقیقه موجودی‌های ارسال‌نشده را دوباره بفرستد، این خط را به `cron` در `liara.json` اضافه کنید:

  ```
  "*/2 * * * * curl --fail --silent --show-error --max-time 60 -H \"Authorization: Bearer $CRON_SECRET\" http://localhost:3000/api/site/hook-flush"
  ```

## ۸. بازگشت (اگر چیزی درست کار نکرد)

- تا DNS عوض نشده، ERP قدیمی روی Vercel کار می‌کند و چیزی برای برگرداندن نیست.
- بعد از عوض شدن: رکورد `erp` را در Cloudflare به همان مقداری برگردانید که در مرحله‌ی ۶ یادداشت کرده بودید.
  - دامنه را از پروژه‌ی Vercel پاک نکنید تا بازگشت کار کند.
  - با DNS only و TTL خودکار، بازگشت چند دقیقه طول می‌کشد.
- **مهم:** هر چیزی که بعد از جابه‌جایی در لیارا ثبت شده، در دیتابیس قدیمی نیست.
  - اگر بعد از یکی‌دو ساعت کار برمی‌گردید، آن ثبت‌ها را باید دستی در ERP قدیمی دوباره وارد کنید.
  - برای همین روز اول را کوتاه نگه دارید و اگر قرار است برگردید، زود برگردید.

## ۹. بعد از جابه‌جایی: خاموش کردن Vercel

بعد از چند روز که ERP روی لیارا درست کار کرد:
1. **build هر چهار پروژه‌ی Vercel را متوقف کنید:** پروژه‌ی اصلی ERP و ۳ پروژه‌ی آینه.
   - build هر کدام `prisma db push` و backfillها را روی دیتابیس قدیمی Prisma Postgres اجرا می‌کند و سهمیه‌ی مصرف آن را می‌خورد. (توقف آن دیتابیس در ۲۸ و ۲۹ سپتامبر به همین سقف مصرف خورده بود.)
   - برای این کار، Git را از پروژه جدا کنید (Settings ← Git ← Disconnect)، یا پروژه را pause یا پاک کنید.
2. cronهای `vercel.json` با خاموش شدن پروژه‌ی اصلی متوقف می‌شوند. اگر پروژه روشن بماند، آن‌ها روی دیتابیس قدیمی پشتیبان می‌گیرند.
3. دسترسی عمومی دیتابیس لیارا را اگر هنوز روشن است خاموش کنید.
4. دیتابیس Prisma Postgres را تا وقتی مطمئن نشده‌اید پاک نکنید. یک پشتیبان آخر از آن نگه دارید.

## خطرها و دسترسی‌های بیرونی از سرور لیارا (ایران)

| مقصد | چه کسی | خطر |
|---|---|---|
| دیتابیس لیارا (شبکه‌ی خصوصی) | Prisma | ندارد |
| FTP لیموهاست 31.214.255.152 (پورت ۲۱ و پورت‌های passive) | رسیدها، عکس کالا، پشتیبان‌ها | کم؛ هر دو در ایران‌اند |
| themoak.com (`/erp/hook`، `/erp/ping`، `/erp/catalogue`) و عکس‌های `themoak.com` در `next/image` | ارسال موجودی، همگام‌سازی عکس | متوسط؛ بسته به اینکه سایت کجا میزبانی می‌شود. در قطعی اینترنت بین‌المللی ارسال‌ها در صف می‌مانند و بعداً می‌روند |
| SMTP (`SMTP_HOST`، مثلاً mail.themoak.com = لیموهاست) | ایمیل فراموشی رمز | متوسط؛ ممکن است پورت‌های SMTP بسته باشند |
| api.openai.com، api.anthropic.com، generativelanguage.googleapis.com، api.groq.com | دستیار هوش مصنوعی | **زیاد**؛ این سرویس‌ها معمولاً IP ایران را رد می‌کنند و بعضی هم از داخل فیلترند. دستیار پیام فارسی می‌دهد و بقیه‌ی ERP کار می‌کند. راه‌های ممکن (تصمیم با شما): سرویس هوش مصنوعی خود لیارا، که OpenAI-compatible است (https://docs.liara.ir/ai/about/)، اما کد فعلی آدرس OpenAI را ثابت دارد و پشتیبانی آن کار جداگانه‌ای است؛ یا تنظیم DNS سرور در لیارا (https://docs.liara.ir/paas/details/dns-server-settings/) |
| مرورگر کاربران: cdnjs.cloudflare.com (PDF فاکتور)، cdn.jsdelivr.net (بارکد)، unpkg.com (اسکنر بارکد) | این‌ها از مرورگر کاربر بار می‌شوند، نه از سرور | مثل امروز |

در زمان build (روی builder آلمان لیارا) این‌ها دانلود می‌شوند:
- npm، از mirror لیارا
- موتورهای Prisma، از binaries.prisma.sh
- دیگر هیچ فونتی از Google Fonts دانلود نمی‌شود.

اگر روزی build به ایران برگشت و موتورهای Prisma دانلود نشدند، `PRISMA_ENGINES_MIRROR` را به یک mirror بدهید. مستندات لیارا mirrorی برای Prisma معرفی نکرده‌اند.

## منابع (مستندات لیارا که این راهنما بر آن‌ها تکیه دارد)

- استقرار Next (npm install، `npm run build`، اسکریپت start): https://docs.liara.ir/paas/nextjs/how-tos/deploy-app/
- `next.config.js` و `output: 'standalone'`: https://docs.liara.ir/paas/nextjs/fix-common-errors/modify-config-file/
- hookها (`liara_pre_start.sh` با دسترسی به env): https://docs.liara.ir/paas/nextjs/how-tos/use-hooks/
- متغیرها در زمان build: https://docs.liara.ir/paas/nextjs/how-tos/set-envs/
- فیلدهای `liara.json` (cron، healthCheck، build.location، next.nodeVersion و next.mirror، منطقه‌ی زمانی پیش‌فرض Asia/Tehran): https://docs.liara.ir/paas/liarajson/
- cron در Next: https://docs.liara.ir/paas/nextjs/how-tos/set-cron-job/
- فایل‌سیستم: https://docs.liara.ir/paas/details/file-system/
- health check: https://docs.liara.ir/paas/details/health-check/
- استقرار بدون قطعی: https://docs.liara.ir/paas/details/zero-downtime-deployment/
- محل build: https://docs.liara.ir/paas/details/build-location/
- نسخه‌های Node: https://docs.liara.ir/paas/nextjs/how-tos/choose-version/
- بسته‌های برنامه: https://docs.liara.ir/paas/details/plans/software-plans/
- بسته‌های دیتابیس: https://docs.liara.ir/dbaas/details/plans/software-plans/
- شبکه‌ی خصوصی: https://docs.liara.ir/paas/details/private-network/
- PostgreSQL: https://docs.liara.ir/dbaas/postgresql/quick-setup/
- پشتیبان دیتابیس: https://docs.liara.ir/dbaas/postgresql/how-tos/create-backup/
- بازگرداندن پشتیبان دیتابیس: https://docs.liara.ir/dbaas/postgresql/how-tos/restore-backup/
- دامنه و SSL: https://docs.liara.ir/paas/domains/add-domain/ و https://docs.liara.ir/paas/domains/use-cdn/
- CLI: https://docs.liara.ir/references/cli/deploy-app/
