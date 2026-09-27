/** Project and task statuses and priorities as a word and a colour (design system §12). */

const SUCCESS = 'bg-success-soft text-success';
const WARNING = 'bg-warning-soft text-warning';
const DANGER = 'bg-danger-soft text-danger';
const BRAND = 'bg-brand-soft text-brand';
const NEUTRAL = 'bg-secondary text-muted-foreground';

export const PILL = 'inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px]';

export const PROJECT_STATUSES = [
  { id: 'ACTIVE', label: 'فعال', tone: BRAND },
  { id: 'ON_HOLD', label: 'متوقف شده', tone: WARNING },
  { id: 'COMPLETED', label: 'تکمیل شده', tone: SUCCESS },
  { id: 'CANCELLED', label: 'لغو شده', tone: DANGER },
];

export const projectStatus = (status: string) =>
  PROJECT_STATUSES.find((s) => s.id === status) ?? { id: status, label: status, tone: NEUTRAL };

const TASK_STATUSES: Record<string, { label: string; tone: string }> = {
  TODO: { label: 'برای انجام', tone: NEUTRAL },
  IN_PROGRESS: { label: 'در حال انجام', tone: BRAND },
  REVIEW: { label: 'در حال بررسی', tone: WARNING },
  DONE: { label: 'انجام شده', tone: SUCCESS },
};

export const taskStatus = (status: string) => TASK_STATUSES[status] ?? { label: status, tone: NEUTRAL };

const PRIORITIES: Record<string, { label: string; tone: string }> = {
  LOW: { label: 'پایین', tone: NEUTRAL },
  MEDIUM: { label: 'متوسط', tone: NEUTRAL },
  HIGH: { label: 'بالا', tone: WARNING },
  URGENT: { label: 'فوری', tone: DANGER },
};

export const taskPriority = (priority: string) => PRIORITIES[priority] ?? { label: priority, tone: NEUTRAL };

export const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Math.round(n));

/** Persian digits without grouping, for years and days. */
export const digits = (n: number) => n.toLocaleString('fa-IR', { useGrouping: false });
