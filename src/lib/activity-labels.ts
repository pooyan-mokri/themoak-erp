/**
 * The Persian name of every action code the code base logs (logActivity,
 * src/lib/activity-log.ts), for every screen that shows the activity log: the
 * CRM page, the dashboard and the users page. A code without a name shows as
 * «فعالیت», never as the code. Plain data, used on both sides.
 */
export const ACTIVITY_LABELS: Record<string, string> = {
  CREATE_USER: 'ایجاد کاربر',
  UPDATE_USER: 'ویرایش کاربر',
  UPDATE_ROLE: 'تغییر نقش کاربر',
  DELETE_USER: 'حذف کاربر',
  ACTIVATE_USER: 'فعال‌سازی کاربر',
  DEACTIVATE_USER: 'غیرفعال‌سازی کاربر',
  SET_PASSWORD: 'تعیین رمز عبور توسط مدیر',
  CHANGE_PASSWORD: 'تغییر رمز عبور',
  RESET_PASSWORD: 'بازیابی رمز عبور',
  UPDATE_PROFILE: 'ویرایش پروفایل',
  ATTACH_RECEIPT: 'ضمیمهٔ رسید',
  REPLACE_RECEIPT: 'تعویض رسید',
  REMOVE_RECEIPT: 'حذف رسید',
  SETTLE_OUTSIDE: 'تسویهٔ فاکتور امانی بیرون از سیستم',
  UPDATE_PAYROLL: 'ویرایش فیش حقوقی',
};

export function activityLabel(action: string | null | undefined): string {
  return (action && ACTIVITY_LABELS[action]) || 'فعالیت';
}
