'use client';

import { useState } from 'react';
import { updateTicketStatus, resolveTicket } from '@/actions/crm';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

const statuses = [
  { value: 'OPEN', label: 'باز' },
  { value: 'IN_PROGRESS', label: 'در حال بررسی' },
  { value: 'RESOLVED', label: 'حل شده' },
  { value: 'CLOSED', label: 'بسته' },
];

interface TicketActionsProps {
  ticketId: string;
  currentStatus: string;
  hasResolution: boolean;
}

export function TicketActions({ ticketId, currentStatus, hasResolution }: TicketActionsProps) {
  const [selectedStatus, setSelectedStatus] = useState(currentStatus);
  const [resolution, setResolution] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [showResolution, setShowResolution] = useState(false);
  const router = useRouter();

  const handleStatusUpdate = async () => {
    if (selectedStatus === currentStatus) {
      toast.info('وضعیت تغییری نکرده است');
      return;
    }

    setIsUpdating(true);
    const result = await updateTicketStatus(ticketId, selectedStatus);
    setIsUpdating(false);

    if (result.success) {
      toast.success(result.message);
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  const handleResolve = async () => {
    if (!resolution.trim()) {
      toast.error('لطفا پاسخ را وارد کنید');
      return;
    }

    setIsUpdating(true);
    const result = await resolveTicket(ticketId, resolution);
    setIsUpdating(false);

    if (result.success) {
      toast.success(result.message);
      setShowResolution(false);
      setResolution('');
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>تغییر وضعیت</Label>
        <div className="flex gap-2">
          <Select value={selectedStatus} onValueChange={setSelectedStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((status) => (
                <SelectItem key={status.value} value={status.value}>
                  {status.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={handleStatusUpdate}
            disabled={isUpdating || selectedStatus === currentStatus}
          >
            بروزرسانی
          </Button>
        </div>
      </div>

      {!hasResolution && (
        <div className="space-y-2">
          {!showResolution ? (
            <Button
              variant="outline"
              onClick={() => setShowResolution(true)}
              className="w-full"
            >
              حل تیکت
            </Button>
          ) : (
            <>
              <Label htmlFor="resolution">پاسخ / راه‌حل</Label>
              <Textarea
                id="resolution"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="راه‌حل یا پاسخ به تیکت را وارد کنید..."
                rows={4}
              />
              <div className="flex gap-2">
                <Button onClick={handleResolve} disabled={isUpdating}>
                  ثبت و حل تیکت
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowResolution(false);
                    setResolution('');
                  }}
                  disabled={isUpdating}
                >
                  انصراف
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
