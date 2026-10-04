'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Bot, Edit, KeyRound, Trash2, UserCheck, UserPlus, UserX } from 'lucide-react';
import { UserForm } from './user-form';
import { SetPasswordDialog } from './set-password-dialog';
import { ApiKeysDialog } from './api-keys-dialog';
import { deleteUser, setUserActive } from '@/actions/user';
import { toast } from 'sonner';
import { Role } from '@/lib/types';
import { ROLES, ROLE_LABELS, describeRole } from '@/lib/permissions';
import { formatJalaliDate } from '@/lib/date-utils';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';
import { SettingsPanel } from './settings-panel';

interface UserListProps {
  users: any[];
}

/** A role is not a status: every role is a quiet pill, the one with full access in indigo. */
const ROLE_BADGE: Record<Role, BadgeProps['variant']> = {
  [Role.ADMIN]: 'default',
  [Role.AUDITOR]: 'secondary',
  [Role.ACCOUNTANT]: 'secondary',
  [Role.SALES]: 'secondary',
  [Role.WAREHOUSE]: 'secondary',
  [Role.PROJECT_MANAGER]: 'secondary',
  [Role.USER]: 'secondary',
};

const fa = (n: number) => n.toLocaleString('fa-IR');

export function UserList({ users }: UserListProps) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(undefined);
  const [passwordUser, setPasswordUser] = useState<{ id: string; name: string } | undefined>(undefined);
  const [keysUser, setKeysUser] = useState<{ id: string; name: string } | undefined>(undefined);

  const handleEdit = (user: any) => {
    setSelectedUser(user);
    setIsFormOpen(true);
  };

  const handleCreate = () => {
    setSelectedUser(undefined);
    setIsFormOpen(true);
  };

  const handleDelete = async (user: any) => {
    if (confirm(`کاربر «${user.name}» (${user.email}) حذف شود؟ این کار برگشت‌پذیر نیست.`)) {
      const result = await deleteUser(user.id);
      if (result.success) {
        toast.success(result.message);
        window.location.reload(); // Refresh to update the list
      } else {
        toast.error(result.message);
      }
    }
  };

  // A deactivated user cannot sign in; their records keep their name (setUserActive, admin only).
  const handleActive = async (user: { id: string; name: string; isActive: boolean }) => {
    if (user.isActive && !confirm(`${user.name} غیرفعال شود؟ دیگر نمی‌تواند وارد شود، ولی سوابقش می‌ماند.`)) return;
    const result = await setUserActive(user.id, !user.isActive);
    if (result.success) {
      toast.success(result.message);
      window.location.reload(); // Refresh to update the list
    } else {
      toast.error(result.message);
    }
  };

  const getRoleBadge = (role: Role) => (
    <Badge variant={ROLE_BADGE[role] ?? 'secondary'} className="whitespace-nowrap">
      {ROLE_LABELS[role] ?? role}
    </Badge>
  );

  return (
    <>
      <SettingsPanel
        title="کاربران"
        count={fa(users.length)}
        description="ایجاد، ویرایش و حذف کاربران سیستم. نقش هر کاربر تعیین می‌کند چه چیزی را ببیند و ثبت کند."
        action={
          <Button onClick={handleCreate}>
            <UserPlus className="h-4 w-4" />
            افزودن کاربر
          </Button>
        }
      >
        <DataTable
          data={users}
          columns={[
            {
              key: 'name',
              label: 'نام',
              sortable: true,
              render: (user) => (
                <span className="flex items-center gap-2.5 whitespace-nowrap">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-soft font-mono text-[11px] text-brand">
                    {String(user.name ?? '').trim()[0] ?? '·'}
                  </span>
                  <span className="font-medium">{user.name}</span>
                </span>
              ),
            },
            {
              // Email and mobile in one column, so the row's actions stay in view beside the settings menu.
              key: 'email',
              label: 'ایمیل و موبایل',
              sortable: true,
              render: (user) => (
                <span className="block font-mono text-[12.5px] leading-5" dir="ltr" style={{ textAlign: 'end' }}>
                  <span className="block text-muted-foreground">{user.email}</span>
                  {user.phone && <span className="block">{user.phone}</span>}
                </span>
              ),
            },
            {
              key: 'role',
              label: 'نقش',
              sortable: true,
              render: (user) => getRoleBadge(user.role as Role),
            },
            {
              key: 'isActive',
              label: 'وضعیت',
              sortable: true,
              render: (user) =>
                user.isActive ? <Badge variant="success">فعال</Badge> : <Badge variant="secondary">غیرفعال</Badge>,
            },
            {
              key: 'createdAt',
              label: 'تاریخ عضویت',
              sortable: true,
              render: (user) => <span className="font-mono text-[12px] text-muted-foreground">{formatJalaliDate(user.createdAt)}</span>,
            },
            {
              key: 'actions',
              label: 'عملیات',
              sortable: false,
              className: 'text-end',
              render: (user) => (
                <div className="flex items-center justify-end gap-1">
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(user)} title="ویرایش" aria-label={`ویرایش ${user.name}`}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPasswordUser(user)}
                    title="تغییر رمز عبور"
                    aria-label={`تغییر رمز عبور ${user.name}`}
                  >
                    <KeyRound className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setKeysUser(user)}
                    title="کلیدهای Claude"
                    aria-label={`کلیدهای Claude ${user.name}`}
                  >
                    <Bot className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleActive(user)}
                    title={user.isActive ? 'غیرفعال کردن' : 'فعال کردن'}
                    aria-label={`${user.isActive ? 'غیرفعال کردن' : 'فعال کردن'} ${user.name}`}
                  >
                    {user.isActive ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={() => handleDelete(user)}
                    title="حذف"
                    aria-label={`حذف ${user.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ),
            },
          ]}
          searchable={true}
          searchPlaceholder="جستجو در کاربران (نام، ایمیل، موبایل)..."
          searchKeys={['name', 'email', 'phone']}
          filterable={true}
          filters={[
            {
              key: 'role',
              label: 'نقش',
              options: ROLES.map((value) => ({ value, label: ROLE_LABELS[value] })),
            },
          ]}
          defaultSort={{ key: 'createdAt', direction: 'desc' }}
          pageSize={15}
          emptyMessage="هیچ کاربری یافت نشد."
        />
      </SettingsPanel>

      <SettingsPanel
        title="نقش‌ها و دسترسی‌ها"
        count={fa(ROLES.length)}
        description="آنچه هر نقش می‌بیند و ثبت می‌کند. نقش هر کاربر را از «ویرایش» عوض کنید."
      >
        <div className="-mx-4 divide-y border-t">
          {ROLES.map((role) => {
            const count = users.filter((user) => user.role === role).length;
            return (
              <div key={role} className="grid gap-1.5 px-4 py-3 sm:grid-cols-[176px_minmax(0,1fr)] sm:gap-4">
                <div className="flex items-center gap-2">
                  {getRoleBadge(role)}
                  <span className="text-[11.5px] text-muted-foreground">{count ? `${fa(count)} کاربر` : 'بدون کاربر'}</span>
                </div>
                <div className="space-y-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                  {describeRole(role).map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </SettingsPanel>

      <UserForm 
        open={isFormOpen} 
        onOpenChange={setIsFormOpen} 
        user={selectedUser} 
      />
      <SetPasswordDialog user={passwordUser} onOpenChange={(open) => !open && setPasswordUser(undefined)} />
      <ApiKeysDialog user={keysUser} onOpenChange={(open) => !open && setKeysUser(undefined)} />
    </>
  );
}
