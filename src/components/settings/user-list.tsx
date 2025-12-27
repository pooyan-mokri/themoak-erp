'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Edit, Trash2, UserPlus } from 'lucide-react';
import { UserForm } from './user-form';
import { deleteUser } from '@/actions/user';
import { toast } from 'sonner';
import { Role } from '@/lib/types';
import { formatJalaliDate } from '@/lib/date-utils';
import { DataTable, DataTableColumn } from '@/components/ui/data-table';

interface UserListProps {
  users: any[];
}

export function UserList({ users }: UserListProps) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(undefined);

  const handleEdit = (user: any) => {
    setSelectedUser(user);
    setIsFormOpen(true);
  };

  const handleCreate = () => {
    setSelectedUser(null);
    setIsFormOpen(true);
  };

  const handleDelete = async (userId: string) => {
    if (confirm('آیا از حذف این کاربر اطمینان دارید؟')) {
      const result = await deleteUser(userId);
      if (result.success) {
        toast.success(result.message);
        window.location.reload(); // Refresh to update the list
      } else {
        toast.error(result.message);
      }
    }
  };

  const getRoleBadge = (role: Role) => {
    const styles = {
      [Role.ADMIN]: 'bg-red-100 text-red-800 hover:bg-red-200',
      [Role.ACCOUNTANT]: 'bg-blue-100 text-blue-800 hover:bg-blue-200',
      [Role.SALES]: 'bg-green-100 text-green-800 hover:bg-green-200',
      [Role.WAREHOUSE]: 'bg-orange-100 text-orange-800 hover:bg-orange-200',
      [Role.PROJECT_MANAGER]: 'bg-purple-100 text-purple-800 hover:bg-purple-200',
      [Role.USER]: 'bg-gray-100 text-gray-800 hover:bg-gray-200',
    };
    
    const labels = {
      [Role.ADMIN]: 'مدیر سیستم',
      [Role.ACCOUNTANT]: 'حسابدار',
      [Role.SALES]: 'فروشنده',
      [Role.WAREHOUSE]: 'انباردار',
      [Role.PROJECT_MANAGER]: 'مدیر پروژه',
      [Role.USER]: 'کاربر عادی',
    };

    return (
      <Badge variant="outline" className={styles[role]}>
        {labels[role]}
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">لیست کاربران</h3>
        <Button onClick={handleCreate}>
          <UserPlus className="ml-2 h-4 w-4" />
          افزودن کاربر
        </Button>
      </div>

      <DataTable
        data={users}
        columns={[
          {
            key: 'name',
            label: 'نام',
            sortable: true,
            render: (user) => <span className="font-medium">{user.name}</span>,
          },
          {
            key: 'email',
            label: 'ایمیل',
            sortable: true,
            render: (user) => user.email,
          },
          {
            key: 'phone',
            label: 'موبایل',
            sortable: true,
            render: (user) => user.phone || '-',
          },
          {
            key: 'role',
            label: 'نقش',
            sortable: true,
            render: (user) => getRoleBadge(user.role as Role),
          },
          {
            key: 'createdAt',
            label: 'تاریخ عضویت',
            sortable: true,
            render: (user) => formatJalaliDate(user.createdAt),
          },
          {
            key: 'actions',
            label: 'عملیات',
            sortable: false,
            className: 'text-right',
            render: (user) => (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={() => handleEdit(user)}>
                  <Edit className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-red-500 hover:text-red-600"
                  onClick={() => handleDelete(user.id)}
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
            options: [
              { value: Role.ADMIN, label: 'مدیر سیستم' },
              { value: Role.ACCOUNTANT, label: 'حسابدار' },
              { value: Role.SALES, label: 'فروشنده' },
              { value: Role.WAREHOUSE, label: 'انباردار' },
              { value: Role.PROJECT_MANAGER, label: 'مدیر پروژه' },
              { value: Role.USER, label: 'کاربر عادی' },
            ],
          },
        ]}
        defaultSort={{ key: 'createdAt', direction: 'desc' }}
        pageSize={15}
        emptyMessage="هیچ کاربری یافت نشد."
      />

      <UserForm 
        open={isFormOpen} 
        onOpenChange={setIsFormOpen} 
        user={selectedUser} 
      />
    </div>
  );
}
