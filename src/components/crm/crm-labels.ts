/**
 * The CRM's statuses as a word and a colour (design system §12): success for a
 * good end, warning for what waits on someone, danger for a loss, indigo for
 * work in progress, grey for the rest.
 */
export type Tone = { label: string; tone: string };

const SUCCESS = 'bg-success-soft text-success';
const WARNING = 'bg-warning-soft text-warning';
const DANGER = 'bg-danger-soft text-danger';
const BRAND = 'bg-brand-soft text-brand';
const NEUTRAL = 'bg-secondary text-muted-foreground';

export const DEAL_STAGES = [
  { id: 'PROSPECT', label: 'سرنخ' },
  { id: 'PROPOSAL', label: 'پیشنهاد' },
  { id: 'NEGOTIATION', label: 'مذاکره' },
  { id: 'WON', label: 'برنده' },
  { id: 'LOST', label: 'باخته' },
] as const;

export function dealStage(stage: string): Tone {
  const label = DEAL_STAGES.find((s) => s.id === stage)?.label ?? stage;
  if (stage === 'WON') return { label, tone: SUCCESS };
  if (stage === 'LOST') return { label, tone: DANGER };
  return { label, tone: BRAND };
}

export function leadStatus(status: string): Tone {
  switch (status) {
    case 'NEW':
      return { label: 'جدید', tone: BRAND };
    case 'CONTACTED':
      return { label: 'تماس گرفته شده', tone: WARNING };
    case 'QUALIFIED':
      return { label: 'واجد شرایط', tone: SUCCESS };
    case 'LOST':
      return { label: 'از دست رفته', tone: DANGER };
    default:
      return { label: status, tone: NEUTRAL };
  }
}

export function ticketPriority(priority: string): Tone {
  switch (priority) {
    case 'URGENT':
      return { label: 'فوری', tone: DANGER };
    case 'HIGH':
      return { label: 'بالا', tone: WARNING };
    case 'MEDIUM':
      return { label: 'متوسط', tone: NEUTRAL };
    case 'LOW':
      return { label: 'پایین', tone: NEUTRAL };
    default:
      return { label: priority, tone: NEUTRAL };
  }
}

export const TICKET_STATUSES = [
  { value: 'OPEN', label: 'باز' },
  { value: 'IN_PROGRESS', label: 'در حال بررسی' },
  { value: 'RESOLVED', label: 'حل شده' },
  { value: 'CLOSED', label: 'بسته' },
];

export function ticketStatus(status: string): Tone {
  const label = TICKET_STATUSES.find((s) => s.value === status)?.label ?? status;
  if (status === 'OPEN') return { label, tone: WARNING };
  if (status === 'IN_PROGRESS') return { label, tone: BRAND };
  if (status === 'RESOLVED') return { label, tone: SUCCESS };
  return { label, tone: NEUTRAL };
}

/** An order's payment, or its cancellation. */
export function orderPayment(order: { status: string; paymentStatus: string }): Tone {
  if (order.status === 'CANCELLED') return { label: 'لغو شده', tone: DANGER };
  if (order.paymentStatus === 'PAID') return { label: 'پرداخت شده', tone: SUCCESS };
  if (order.paymentStatus === 'PARTIAL') return { label: 'پرداخت جزئی', tone: BRAND };
  return { label: 'پرداخت نشده', tone: WARNING };
}

/** The segment values the ERP uses (the old customer filter's options), in this order. */
export const SEGMENTS = ['VIP', 'عادی', 'عمده'];

export const PILL = 'inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px]';

export const fa = (n: number) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Math.round(n));
