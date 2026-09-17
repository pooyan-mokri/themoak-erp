import type { Role } from '@prisma/client';

/**
 * Who may see and do what. Pure data and functions with no server imports, so
 * client components (menus, forms) and server code (actions, page guards) share
 * one source of truth. Server-side checks live in @/lib/access.
 */

export type Permission =
  | 'cost.view' // product cost price, purchase unit prices, landed cost, stock value, audit discrepancy values, COGS, gift cost
  | 'cost.edit' // set or change a product's cost price
  | 'profit.view' // profit and loss, balance sheet, margins, shareholder profits
  | 'finance.view' // balances, transactions, expenses, reconciliation, AR aging, revenue analytics, supplier PO totals, fixed asset values
  | 'finance.manage' // accounts, expenses, deposits, withdrawals, transfers, currency exchange, shareholder withdrawals, supplier payments
  | 'payroll.view' // employees' pay data, payroll, loans, employee debts
  | 'payroll.manage'
  | 'accounts.pick' // account id, name, type, currency, card number, IBAN for pickers (no balance)
  | 'sales.view' // sell prices, orders with amounts, customers with their debt and credit
  | 'sales.manage' // create orders, returns, exchanges, customers; record an order payment
  | 'stock.view' // products and stock quantities (no money)
  | 'stock.manage' // products (except cost), stock moves, transfers, receiving, audit counting
  | 'users.manage'
  | 'settings.manage'
  | 'projects.manage'; // create and edit projects and their tasks: everyone but the read-only AUDITOR

export const ALL_PERMISSIONS: readonly Permission[] = [
  'cost.view',
  'cost.edit',
  'profit.view',
  'finance.view',
  'finance.manage',
  'payroll.view',
  'payroll.manage',
  'accounts.pick',
  'sales.view',
  'sales.manage',
  'stock.view',
  'stock.manage',
  'users.manage',
  'settings.manage',
  'projects.manage',
];

/** The matrix the owner approved. AUDITOR is read-only; ACCOUNTANT never sees cost or profit. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: ALL_PERMISSIONS,
  AUDITOR: ['cost.view', 'profit.view', 'finance.view', 'payroll.view', 'accounts.pick', 'sales.view', 'stock.view'],
  ACCOUNTANT: [
    'finance.view',
    'finance.manage',
    'payroll.view',
    'payroll.manage',
    'accounts.pick',
    'sales.view',
    'sales.manage',
    'stock.view',
    'projects.manage',
  ],
  SALES: ['accounts.pick', 'sales.view', 'sales.manage', 'stock.view', 'projects.manage'],
  WAREHOUSE: ['stock.view', 'stock.manage', 'projects.manage'],
  PROJECT_MANAGER: ['projects.manage'],
  USER: ['projects.manage'],
};

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'مدیر سیستم',
  AUDITOR: 'حسابرس',
  ACCOUNTANT: 'حسابدار',
  SALES: 'فروشنده',
  WAREHOUSE: 'انباردار',
  PROJECT_MANAGER: 'مدیر پروژه',
  USER: 'کاربر عادی',
};

/** Every role, in the order role pickers list them. */
export const ROLES = Object.keys(ROLE_LABELS) as Role[];

export function can(role: string | null | undefined, permission: Permission): boolean {
  if (!role || !Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, role)) return false;
  return ROLE_PERMISSIONS[role as Role].includes(permission);
}

export function canAny(role: string | null | undefined, permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => can(role, permission));
}

const SEES: [Permission, string][] = [
  ['finance.view', 'امور مالی'],
  ['payroll.view', 'حقوق و دستمزد'],
  ['sales.view', 'فروش و مشتریان'],
  ['stock.view', 'کالا و موجودی'],
  ['cost.view', 'بهای تمام‌شده'],
  ['profit.view', 'سود و زیان'],
];

const MANAGES: [Permission, string][] = [
  ['finance.manage', 'امور مالی'],
  ['payroll.manage', 'حقوق و دستمزد'],
  ['sales.manage', 'فروش و مشتریان'],
  ['stock.manage', 'کالا و انبار'],
  ['cost.edit', 'بهای تمام‌شده'],
  ['users.manage', 'کاربران'],
  ['settings.manage', 'تنظیمات'],
  ['projects.manage', 'پروژه‌ها'],
];

/** A short Persian summary of what a role can see and change, derived from the matrix. */
export function describeRole(role: string): string[] {
  const sees = SEES.filter(([p]) => can(role, p)).map(([, label]) => label);
  const manages = MANAGES.filter(([p]) => can(role, p)).map(([, label]) => label);
  if (sees.length === 0) return ['فقط داشبورد، پروژه‌ها، دستیار هوش مصنوعی و پروفایل خود را می‌بیند.'];
  const lines = [`می‌بیند: ${sees.join('، ')}.`];
  lines.push(manages.length ? `ثبت و ویرایش: ${manages.join('، ')}.` : 'فقط مشاهده؛ چیزی ثبت یا ویرایش نمی‌کند.');
  if (!can(role, 'cost.view')) lines.push('بهای تمام‌شده و سود را نمی‌بیند.');
  return lines;
}

/**
 * Dashboard sections by path prefix. A user may open a path if they hold ANY
 * permission of the longest matching prefix; a path with no matching prefix is
 * open to every signed-in user (dashboard, projects, assistant, profile).
 *
 * The sidebar and the mobile menu read this table, and so do the page guards:
 * every server page below a prefix starts with requireRouteAccess(<its longest
 * prefix>), and each prefix has a layout.tsx doing the same. Nested layouts
 * check every ancestor, so a child entry must never admit a role its parent
 * refuses. tests/security/permissions.test.ts enforces all of this.
 */
export const ROUTE_PERMISSIONS = {
  '/dashboard/accounting': ['finance.view'],
  '/dashboard/accounting/employees': ['payroll.view'],
  '/dashboard/accounting/payroll': ['payroll.view'],
  '/dashboard/accounting/loans': ['payroll.view'],
  '/dashboard/accounting/employee-debts': ['payroll.view'],
  '/dashboard/accounting/reports': ['profit.view'],
  '/dashboard/accounting/shareholders/profits': ['profit.view'],

  '/dashboard/inventory': ['stock.view'],
  '/dashboard/inventory/reports': ['cost.view'],
  '/dashboard/inventory/assets': ['finance.view'],

  '/dashboard/sales': ['sales.view'],
  '/dashboard/sales/analytics': ['finance.view'],
  '/dashboard/consignment': ['sales.view'],
  '/dashboard/crm': ['sales.view'],
  '/dashboard/marketing': ['sales.view'],

  '/dashboard/suppliers': ['stock.view', 'finance.view'],

  '/dashboard/reports': ['profit.view', 'sales.view', 'cost.view'],
  '/dashboard/reports/financial': ['profit.view'],
  '/dashboard/reports/sales': ['sales.view'],
  '/dashboard/reports/inventory': ['cost.view'],
  '/dashboard/reporting': ['profit.view'],

  '/dashboard/search': ['stock.view', 'sales.view', 'finance.view'],

  '/dashboard/settings/users': ['users.manage'],
  '/dashboard/settings/backup': ['settings.manage'],
  '/dashboard/settings/site': ['settings.manage'],
  '/dashboard/admin': ['users.manage'],
} as const satisfies Record<string, readonly Permission[]>;

export type RoutePrefix = keyof typeof ROUTE_PERMISSIONS;

/** The permissions (any-of) guarding a path, or null when every signed-in user may open it. */
export function routePermissions(pathname: string): readonly Permission[] | null {
  let match: RoutePrefix | null = null;
  for (const prefix of Object.keys(ROUTE_PERMISSIONS) as RoutePrefix[]) {
    if ((pathname === prefix || pathname.startsWith(`${prefix}/`)) && (!match || prefix.length > match.length)) {
      match = prefix;
    }
  }
  return match ? ROUTE_PERMISSIONS[match] : null;
}

export function canAccessRoute(role: string | null | undefined, pathname: string): boolean {
  const permissions = routePermissions(pathname);
  return permissions === null || canAny(role, permissions);
}

/** Menu items shown while the session is still loading: nothing sensitive. */
export const NAV_WHILE_LOADING: readonly string[] = ['/dashboard', '/dashboard/settings'];
