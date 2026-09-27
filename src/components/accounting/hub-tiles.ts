import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  BookOpen,
  Building2,
  Calculator,
  Coins,
  CreditCard,
  DollarSign,
  HandCoins,
  Receipt,
  Scale,
  TrendingDown,
  TrendingUp,
  UserCircle,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/**
 * The accounting hub's sections. Plain data (no 'use client'), so the page
 * decides which the role may open and the client grid draws them.
 */

export type HubGroup = 'entry' | 'books' | 'people';

export const HUB_GROUPS: { id: HubGroup; label: string }[] = [
  { id: 'entry', label: 'ثبت سند' },
  { id: 'books', label: 'حساب‌ها و گزارش‌ها' },
  { id: 'people', label: 'کارکنان و حقوق' },
];

export type HubTile = {
  href: string;
  /** The small line above the title. */
  eyebrow: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  group: HubGroup;
  /** Records money: shown only to a role that may (finance.manage). */
  records?: boolean;
};

export const HUB_TILES: HubTile[] = [
  { href: '/dashboard/accounting/accounts', eyebrow: 'حساب‌ها', title: 'مدیریت حساب‌ها', subtitle: 'تعریف بانک، صندوق و حساب اشخاص', icon: CreditCard, group: 'books' },
  { href: '/dashboard/accounting/expenses/new', eyebrow: 'ثبت هزینه', title: 'هزینه جدید', subtitle: 'ثبت هزینه‌های جاری و پروژه‌ای', icon: Receipt, group: 'entry', records: true },
  { href: '/dashboard/accounting/deposits/new', eyebrow: 'ثبت واریز', title: 'واریز جدید', subtitle: 'ثبت واریز پول به حساب‌ها', icon: ArrowDownToLine, group: 'entry', records: true },
  { href: '/dashboard/accounting/withdrawals/new', eyebrow: 'ثبت پرداخت', title: 'پرداخت جدید', subtitle: 'برداشت / پرداخت به اشخاص', icon: ArrowUpFromLine, group: 'entry', records: true },
  { href: '/dashboard/accounting/transfers/new', eyebrow: 'انتقال وجه', title: 'انتقال داخلی', subtitle: 'جابجایی بین حساب‌های خودمان', icon: ArrowLeftRight, group: 'entry', records: true },
  { href: '/dashboard/accounting/currency-exchange', eyebrow: 'خرید و فروش ارز', title: 'معامله ارز', subtitle: 'خرید و فروش ارز بین حساب‌های مختلف', icon: Coins, group: 'entry' },
  { href: '/dashboard/accounting/exchange-rates', eyebrow: 'نرخ ارز', title: 'مدیریت نرخ ارز', subtitle: 'بروزرسانی نرخ تبدیل ارزها', icon: DollarSign, group: 'books' },
  { href: '/dashboard/accounting/reports', eyebrow: 'گزارش‌های مالی', title: 'گزارش‌ها', subtitle: 'صورت سود و زیان و ترازنامه', icon: Calculator, group: 'books' },
  { href: '/dashboard/accounting/transactions', eyebrow: 'دفتر روزنامه', title: 'تراکنش‌ها', subtitle: 'مشاهده تمام تراکنش‌های مالی', icon: BookOpen, group: 'books' },
  { href: '/dashboard/accounting/reconciliation', eyebrow: 'مغایرت‌گیری حساب‌ها', title: 'بررسی و اصلاح', subtitle: 'مقایسه موجودی ثبت‌شده با جمع تراکنش‌ها و اصلاح آن', icon: Scale, group: 'books' },
  { href: '/dashboard/accounting/ar-aging', eyebrow: 'طلب از مشتریان', title: 'حساب‌های دریافتنی', subtitle: 'گزارش سنی مطالبات و مشتریان بدهکار', icon: TrendingUp, group: 'books' },
  { href: '/dashboard/accounting/assets', eyebrow: 'دارایی‌ها', title: 'دارایی‌های ثابت', subtitle: 'فهرست دارایی‌ها، ارزش فعلی و ثبت استهلاک', icon: Building2, group: 'books' },
  { href: '/dashboard/accounting/shareholders', eyebrow: 'صاحبان سهام', title: 'مدیریت سهامداران', subtitle: 'تعریف صاحبان سهام و واریز سرمایه', icon: Users, group: 'books' },
  { href: '/dashboard/accounting/employees', eyebrow: 'کارمندان', title: 'مدیریت کارمندان', subtitle: 'تعریف و مدیریت اطلاعات کارمندان', icon: UserCircle, group: 'people' },
  { href: '/dashboard/accounting/payroll', eyebrow: 'حقوق و دستمزد', title: 'مدیریت حقوق', subtitle: 'ثبت فیش حقوقی و پرداخت حقوق', icon: Wallet, group: 'people' },
  { href: '/dashboard/accounting/loans', eyebrow: 'قرض‌ها', title: 'مدیریت قرض‌ها', subtitle: 'ثبت و مدیریت قرض‌های کارمندان', icon: HandCoins, group: 'people' },
  { href: '/dashboard/accounting/employee-debts', eyebrow: 'حساب‌های پرداختنی', title: 'بدهی کارمندان', subtitle: 'مشاهده و بازپرداخت بدهی کارمندان', icon: TrendingDown, group: 'people' },
];
