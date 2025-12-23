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
    'woocommerce': 'WooCommerce',
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
    'new': 'جدید',
    'edit': 'ویرایش',
    'barcode': 'بارکد',
    'print': 'چاپ',
  };
  
  // Build breadcrumb items
  let currentPath = '/dashboard';
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLast = i === segments.length - 1;
    
    // Skip numeric IDs (like project IDs, order IDs, etc.) - they will be replaced by customLabel
    if (/^[a-zA-Z0-9]{20,}$/.test(segment)) {
      // This looks like a CUID (long alphanumeric ID)
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

