/** Campaign statuses and channels as the marketing screens show them. */

export const CAMPAIGN_STATUSES = [
  { id: 'PLANNED', label: 'برنامه‌ریزی شده', tone: 'bg-brand-soft text-brand' },
  { id: 'ACTIVE', label: 'فعال', tone: 'bg-success-soft text-success' },
  { id: 'COMPLETED', label: 'تکمیل شده', tone: 'bg-secondary text-muted-foreground' },
  { id: 'CANCELLED', label: 'لغو شده', tone: 'bg-danger-soft text-danger' },
];

export const campaignStatus = (status: string) =>
  CAMPAIGN_STATUSES.find((s) => s.id === status) ?? { id: status, label: status, tone: 'bg-secondary text-muted-foreground' };

/** A campaign's type is its channel: a short code for the square and the Persian name beside it. */
export const CHANNELS: Record<string, { code: string; label: string }> = {
  SOCIAL_MEDIA: { code: 'SOC', label: 'شبکه‌های اجتماعی' },
  EMAIL: { code: 'EM', label: 'ایمیل' },
  PRINT: { code: 'PRT', label: 'چاپی' },
  EVENT: { code: 'EVT', label: 'رویداد' },
  OTHER: { code: 'OTH', label: 'سایر' },
};

export const channelOf = (type: string) => CHANNELS[type] ?? { code: type.slice(0, 3).toUpperCase(), label: type };

export const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Math.round(n));
