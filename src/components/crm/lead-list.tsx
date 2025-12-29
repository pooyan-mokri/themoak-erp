'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eye, UserPlus } from 'lucide-react';
import Link from 'next/link';

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
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'NEW':
        return 'default';
      case 'CONTACTED':
        return 'secondary';
      case 'QUALIFIED':
        return 'default';
      case 'LOST':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'NEW':
        return 'جدید';
      case 'CONTACTED':
        return 'تماس گرفته شده';
      case 'QUALIFIED':
        return 'واجد شرایط';
      case 'LOST':
        return 'از دست رفته';
      default:
        return status;
    }
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>نام</TableHead>
            <TableHead>شرکت</TableHead>
            <TableHead>تماس</TableHead>
            <TableHead>منبع</TableHead>
            <TableHead>امتیاز</TableHead>
            <TableHead>ارزش مورد انتظار</TableHead>
            <TableHead>وضعیت</TableHead>
            <TableHead className="text-left">عملیات</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                هیچ سرنخی یافت نشد.
              </TableCell>
            </TableRow>
          ) : (
            leads.map((lead) => (
              <TableRow key={lead.id}>
                <TableCell className="font-medium">{lead.name}</TableCell>
                <TableCell>{lead.company || '-'}</TableCell>
                <TableCell>
                  <div className="text-sm">
                    <div>{lead.phone || '-'}</div>
                    <div className="text-muted-foreground">{lead.email || '-'}</div>
                  </div>
                </TableCell>
                <TableCell>{lead.source || '-'}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-500" 
                        style={{ width: `${lead.score}%` }}
                      />
                    </div>
                    <span className="text-sm">{lead.score}</span>
                  </div>
                </TableCell>
                <TableCell>
                  {lead.expectedValue 
                    ? `${new Intl.NumberFormat('fa-IR').format(Number(lead.expectedValue))} تومان`
                    : '-'}
                </TableCell>
                <TableCell>
                  <Badge variant={getStatusColor(lead.status)}>
                    {getStatusLabel(lead.status)}
                  </Badge>
                </TableCell>
                <TableCell className="text-left">
                  <div className="flex justify-end gap-2">
                    <Link href={`/dashboard/crm/leads/${lead.id}`}>
                      <Button variant="ghost" size="icon">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
