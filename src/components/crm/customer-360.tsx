import { Mail, Phone, MapPin, Calendar, Star, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { formatJalaliDate } from '@/lib/date-utils';
import { PILL, fa } from './crm-labels';

interface Customer360Props {
  customer: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    customerType: string;
    segment?: string;
    loyaltyPoints: number;
    createdAt: Date;
  };
  /** May edit the customer (sales.manage). */
  canManage?: boolean;
}

/** The customer's card: contact details, type and segment, membership date and loyalty points. */
export function Customer360({ customer, canManage = true }: Customer360Props) {
  const rows = [
    { icon: Phone, value: customer.phone, ltr: true },
    { icon: Mail, value: customer.email, ltr: true },
    { icon: MapPin, value: customer.address },
    { icon: Calendar, value: `عضویت: ${formatJalaliDate(customer.createdAt)}` },
    { icon: Star, value: `امتیاز وفاداری: ${fa(customer.loyaltyPoints)}` },
  ];

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start gap-3">
        {/* The initial, drawn here: no third-party avatar service receives the customer's name. */}
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-brand-soft text-lg text-brand">
          {customer.name.trim().charAt(0) || '؟'}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-medium">{customer.name}</h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className={cn(PILL, 'bg-secondary text-muted-foreground')}>
              {customer.customerType === 'BUSINESS' ? 'شرکتی' : 'حقیقی'}
            </span>
            {customer.segment && (
              <span className={cn(PILL, customer.segment === 'VIP' ? 'bg-brand-soft text-brand' : 'bg-secondary text-muted-foreground')}>
                {customer.segment}
              </span>
            )}
          </div>
        </div>
        {canManage && (
          <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="ویرایش مشتری">
            <Link href={`/dashboard/crm/customers/${customer.id}/edit`}>
              <Pencil className="h-4 w-4 text-muted-foreground" />
            </Link>
          </Button>
        )}
      </div>

      <ul className="mt-4 space-y-2.5 border-t pt-3 text-[13px]">
        {rows.map(({ icon: Icon, value, ltr }, index) => (
          <li key={index} className="flex items-start gap-2.5">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            <span className={cn('min-w-0 break-words', ltr && 'font-mono text-[12.5px]', !value && 'text-muted-foreground')} dir={ltr ? 'ltr' : undefined}>
              {value || '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
