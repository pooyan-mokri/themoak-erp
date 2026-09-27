'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Eye } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { PILL, fa, leadStatus } from './crm-labels';

interface Lead {
  id: string;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  source?: string;
  status: string;
  score: number;
  expectedValue: any;
  createdAt: Date;
}

interface LeadListProps {
  leads: Lead[];
}

export function LeadList({ leads }: LeadListProps) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>نام</TableHead>
            <TableHead>شرکت</TableHead>
            <TableHead>تماس</TableHead>
            <TableHead>منبع</TableHead>
            <TableHead>امتیاز</TableHead>
            <TableHead className="text-end">ارزش مورد انتظار (تومان)</TableHead>
            <TableHead>وضعیت</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                هیچ سرنخی ثبت نشده است. هر کسی که به خرید علاقه نشان داده را با «سرنخ جدید» ثبت کنید.
              </TableCell>
            </TableRow>
          ) : (
            leads.map((lead) => {
              const status = leadStatus(lead.status);
              return (
                <TableRow key={lead.id}>
                  <TableCell className="font-medium">
                    <Link href={`/dashboard/crm/leads/${lead.id}`} className="hover:text-brand hover:underline">
                      {lead.name}
                    </Link>
                  </TableCell>
                  <TableCell>{lead.company || '—'}</TableCell>
                  <TableCell>
                    <div className="text-[12.5px] leading-tight">
                      <div className="font-mono text-[12px]" dir="ltr" style={{ textAlign: 'end' }}>
                        {lead.phone || '—'}
                      </div>
                      {lead.email && <div className="font-mono text-[11.5px] text-muted-foreground">{lead.email}</div>}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{lead.source || '—'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full bg-brand" style={{ width: `${Math.min(100, Math.max(0, lead.score))}%` }} />
                      </div>
                      <span className="font-mono text-[11.5px] text-muted-foreground">{fa(lead.score)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-end">{lead.expectedValue ? fa(Number(lead.expectedValue)) : '—'}</TableCell>
                  <TableCell>
                    <span className={cn(PILL, status.tone)}>{status.label}</span>
                  </TableCell>
                  <TableCell className="text-end">
                    <Button asChild variant="ghost" size="icon" className="h-8 w-8" title="جزئیات سرنخ">
                      <Link href={`/dashboard/crm/leads/${lead.id}`}>
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
