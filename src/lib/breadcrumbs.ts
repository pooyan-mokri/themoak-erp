import { BreadcrumbItem } from '@/components/ui/breadcrumb';

/**
 * Generate breadcrumb items based on the current pathname
 */
export function getBreadcrumbs(pathname: string): BreadcrumbItem[] {
  // Remove /dashboard prefix
  const path = pathname.replace(/^\/dashboard/, '') || '/';
  
  // Split path into segments
  const segments = path.split('/').filter(Boolean);
  
  const breadcrumbs: BreadcrumbItem[] = [];
  
  // Map of path segments to labels
  const labels: Record<string, string> = {
    '': 'داشبورد',
    'sales': 'فروش',
    'orders': 'سفارشات',
    'history': 'تاریخچه فروش',
    'analytics': 'گزارشات و تحلیل',
    'invoices': 'فاکتورها',
    'inventory': 'انبار',
    'warehouses': 'انبارها',
    'products': 'محصولات',
    'web-ids': 'شناسه‌های سایت',
    'fixed-assets': 'دارایی‌های ثابت',
    'audits': 'انبارگردانی',
    'console': 'کنسول انبار',
    'adjustments': 'تعدیل موجودی',
    'purchase': 'خرید',
    'suppliers': 'تامین‌کنندگان',
    'accounting': 'حسابداری',
    'expenses': 'هزینه‌ها',
    'income': 'درآمد',
    'accounts': 'حساب‌ها',
    'shareholders': 'سهامداران',
    'profits': 'سود سهامداران',
    'projects': 'پروژه‌ها',
    'calendar': 'تقویم',
    'marketing': 'بازاریابی',
    'gifts': 'هدایا',
    'campaigns': 'کمپین‌ها',
    'crm': 'مدیریت ارتباط با مشتری',
    'leads': 'سرنخ‌ها',
    'deals': 'معاملات',
    'customers': 'مشتریان',
    'support': 'پشتیبانی',
    'consignment': 'امانی',
    'partners': 'همکاران',
    'transfer': 'انتقال کالا',
    'settlement': 'تسویه حساب',
    'commissions': 'کمیسیون',
    'reports': 'گزارشات',
    'settings': 'تنظیمات',
    'users': 'کاربران',
    'assistant': 'دستیار هوش مصنوعی',
    'employees': 'کارمندان',
    'payroll': 'حقوق و دستمزد',
    'loans': 'وام‌ها',
    'currency-exchange': 'خرید و فروش ارز',
    'transfers': 'انتقال وجه',
    'deposits': 'واریزها',
    'withdrawals': 'پرداخت‌ها',
    'new': 'جدید',
    'edit': 'ویرایش',
    'barcode': 'بارکد',
    'labels': 'چاپ گروهی برچسب',
    'print': 'چاپ',
    'no-access': 'عدم دسترسی',
    'admin': 'مدیریت',
    'ar-aging': 'گزارش سنی مطالبات',
    'archived': 'آرشیو',
    'assets': 'دارایی‌های ثابت',
    'backup': 'پشتیبان‌گیری',
    'employee-debts': 'بدهی کارمندان',
    'exchange-rates': 'نرخ ارز',
    'financial': 'مالی',
    'lost-stock': 'موجودی بازنگشته',
    'management': 'مدیریت',
    'pos': 'صندوق فروش',
    'profile': 'پروفایل',
    'promotions': 'کمپین‌های تخفیف',
    'reconciliation': 'مغایرت‌گیری',
    'reporting': 'گزارشات مالی',
    'return': 'برگشت کالا',
    'returns': 'عودت‌ها و تعویض‌ها',
    'search': 'جستجو',
    'site': 'سایت',
    'statement': 'کارت حساب',
    'transactions': 'دفتر روزنامه',
    'site-review': 'پرداخت‌های سایت برای بررسی',
  };
  
  // Build breadcrumb items
  let currentPath = '/dashboard';
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLast = i === segments.length - 1;
    
    // Skip record ids (a cuid, or a POS sale's order id pos-<requestId> from
    // src/actions/sales.ts): they will be replaced by customLabel. The path
    // still goes through them, so a later crumb (/print) links to its record.
    if (/^[a-zA-Z0-9]{20,}$/.test(segment) || /^pos-[A-Za-z0-9_-]{8,64}$/.test(segment)) {
      currentPath += `/${segment}`;
      continue;
    }
    
    currentPath += `/${segment}`;
    
    // Try to get label from map, or use segment as fallback
    const label = labels[segment] || segment;
    
    // Always add href for non-last items, and for last item only if it's not the final destination
    breadcrumbs.push({
      label,
      href: currentPath,
    });
  }
  
  return breadcrumbs;
}

/**
 * Get custom breadcrumb for specific pages
 */
export function getCustomBreadcrumbs(pathname: string, customData?: Record<string, string>): BreadcrumbItem[] {
  const baseBreadcrumbs = getBreadcrumbs(pathname);
  
  // If custom data is provided, replace the last item with custom label
  if (customData && baseBreadcrumbs.length > 0) {
    const lastSegment = pathname.split('/').filter(Boolean).pop();
    if (lastSegment && customData[lastSegment]) {
      baseBreadcrumbs[baseBreadcrumbs.length - 1] = {
        ...baseBreadcrumbs[baseBreadcrumbs.length - 1],
        label: customData[lastSegment],
      };
    }
  }
  
  return baseBreadcrumbs;
}

