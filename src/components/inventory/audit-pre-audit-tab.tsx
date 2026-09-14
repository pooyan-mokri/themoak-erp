'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { freezeInventory, addAuditTeamMember, removeAuditTeamMember } from '@/actions/inventory-audit';
import { getUsers } from '@/actions/user';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { Camera, Users, CheckCircle2, XCircle, Plus } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

interface PreAuditTabProps {
  audit: any;
}

export function PreAuditTab({ audit }: PreAuditTabProps) {
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<string>('COUNTER');
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [freezing, setFreezing] = useState(false);

  const loadUsers = async () => {
    try {
      const usersList = await getUsers();
      setUsers(usersList);
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const handleFreezeInventory = async () => {
    if (!confirm('آیا مطمئن هستید؟ موجودی فعلی این انبار به‌عنوان مبنای شمارش ثبت می‌شود و شمارش شروع می‌شود. این کار موجودی را قفل نمی‌کند و قابل بازگشت نیست.')) {
      return;
    }

    setFreezing(true);
    try {
      const result = await freezeInventory(audit.id);
      if (result.success) {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      console.error('Error freezing inventory:', error);
      toast.error('خطا در ارتباط با سرور. صفحه را تازه کنید؛ اگر «موجودی فریز شده است» را نمی‌بینید، دوباره فریز کنید.');
    } finally {
      setFreezing(false);
    }
  };


  const handleAddTeamMember = async () => {
    if (!selectedUserId) {
      toast.error('لطفاً کاربر را انتخاب کنید.');
      return;
    }

    const result = await addAuditTeamMember(audit.id, selectedUserId, selectedRole);
    if (result.success) {
      toast.success(result.message);
      setAddMemberOpen(false);
      setSelectedUserId('');
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  const handleRemoveTeamMember = async (userId: string) => {
    if (!confirm('آیا مطمئن هستید که می‌خواهید این عضو را از تیم حذف کنید؟')) {
      return;
    }

    const result = await removeAuditTeamMember(audit.id, userId);
    if (result.success) {
      toast.success(result.message);
      router.refresh();
    } else {
      toast.error(result.message);
    }
  };

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      COUNTER: 'شمارشگر',
      SUPERVISOR: 'ناظر',
      AUDITOR: 'حسابرس',
    };
    return labels[role] || role;
  };

  // The page may load only the number of frozen items, not the snapshots themselves.
  const snapshotCount: number = audit._count?.snapshots ?? audit.snapshots?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Freeze Inventory Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            فریز کردن موجودی
          </CardTitle>
          <CardDescription>
            با فریز کردن موجودی، یک اسنپ‌شات از موجودی فعلی گرفته می‌شود و عملیات شمارش شروع می‌شود. فریز موجودی را قفل نمی‌کند: فروش و جابه‌جایی همچنان موجودی را تغییر می‌دهند.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {audit.isFrozen ? (
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">موجودی فریز شده است</span>
              {audit.frozenAt && (
                <span className="text-sm text-muted-foreground">
                  در تاریخ: {new Date(audit.frozenAt).toLocaleDateString('fa-IR')}
                </span>
              )}
            </div>
          ) : (
            <Button onClick={handleFreezeInventory} disabled={audit.status !== 'PLANNED' || freezing}>
              <Camera className="h-4 w-4 mr-2" />
              {freezing ? 'در حال فریز...' : 'فریز کردن موجودی'}
            </Button>
          )}
          {snapshotCount > 0 && (
            <p className="text-sm text-muted-foreground mt-2">
              تعداد آیتم‌های فریز شده: {snapshotCount}
            </p>
          )}
          {(audit.status === 'PLANNED' || audit.status === 'IN_PROGRESS') && (
            <div className="mt-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-900">
              <p className="font-medium">از فریز تا صدور اسناد اصلاحی، در این انبار انجام ندهید:</p>
              <ul className="mt-1 pr-5 list-disc space-y-0.5">
                <li>فروش حضوری از این انبار</li>
                <li>انتقال موجودی به این انبار یا از آن</li>
                <li>انتقال امانی از این انبار</li>
                <li>دریافت کالای خرید</li>
                <li>ویرایش دستی موجودی</li>
                <li>مرجوعی یا تعویضی که به موجودی این انبار برمی‌گردد</li>
              </ul>
              <p className="mt-1">
                کالای سفارش‌های سایت که بعد از فریز ثبت می‌شوند، تا صدور اسناد اصلاحی روی قفسه می‌ماند و شمرده می‌شود.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Team Management Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            مدیریت تیم شمارشگر
          </CardTitle>
          <CardDescription>
            اعضای تیم شمارشگر و دسترسی‌های هر انبار را مدیریت کنید.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-center mb-4">
            <span className="text-sm font-medium">
              تعداد اعضا: {audit.teams?.length || 0}
            </span>
            <Dialog open={addMemberOpen} onOpenChange={setAddMemberOpen}>
              <DialogTrigger asChild>
                <Button
                  size="sm"
                  onClick={() => {
                    loadUsers();
                    setAddMemberOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  افزودن عضو
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>افزودن عضو به تیم</DialogTitle>
                  <DialogDescription>
                    یک کاربر را به تیم شمارشگر اضافه کنید.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>کاربر</Label>
                    <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                      <SelectTrigger>
                        <SelectValue placeholder="انتخاب کاربر" />
                      </SelectTrigger>
                      <SelectContent>
                        {users.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.name} ({user.email})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>نقش</Label>
                    <Select value={selectedRole} onValueChange={setSelectedRole}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="COUNTER">شمارشگر</SelectItem>
                        <SelectItem value="SUPERVISOR">ناظر</SelectItem>
                        <SelectItem value="AUDITOR">حسابرس</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddMemberOpen(false)}>
                    انصراف
                  </Button>
                  <Button onClick={handleAddTeamMember}>افزودن</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {audit.teams && audit.teams.length > 0 ? (
            <div className="space-y-2">
              {audit.teams.map((team: any) => (
                <div
                  key={team.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="font-medium">{team.user.name}</p>
                      <p className="text-sm text-muted-foreground">{team.user.email}</p>
                    </div>
                    <Badge variant="outline">{getRoleLabel(team.role)}</Badge>
                    {team.canCount && (
                      <Badge variant="secondary" className="text-xs">
                        شمارش
                      </Badge>
                    )}
                    {team.canApprove && (
                      <Badge variant="secondary" className="text-xs">
                        تأیید
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveTeamMember(team.userId)}
                  >
                    <XCircle className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              هیچ عضوی به تیم اضافه نشده است.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

