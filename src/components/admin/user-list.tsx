
'use client';

import { deleteUser, updateUserRole } from '@/actions/user';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Role } from '@prisma/client';
import { MoreHorizontal, Trash } from 'lucide-react';

import { formatJalaliDate } from '@/lib/date-utils';
interface UserListProps {
  users: any[];
}

export function UserList({ users }: UserListProps) {
  const handleRoleChange = async (userId: string, newRole: Role) => {
    await updateUserRole(userId, newRole);
  };

  const handleDelete = async (userId: string) => {
    if (confirm('آیا از حذف این کاربر اطمینان دارید؟')) {
      await deleteUser(userId);
    }
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-right">نام</TableHead>
            <TableHead className="text-right">ایمیل</TableHead>
            <TableHead className="text-right">نقش</TableHead>
            <TableHead className="text-right">تاریخ عضویت</TableHead>
            <TableHead className="text-right">عملیات</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id}>
              <TableCell className="font-medium">{user.name}</TableCell>
              <TableCell>{user.email}</TableCell>
              <TableCell>
                <Badge variant="outline">{user.role}</Badge>
              </TableCell>
              <TableCell>
                {formatJalaliDate(user.createdAt)}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-8 w-8 p-0">
                      <span className="sr-only">Open menu</span>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleRoleChange(user.id, 'ADMIN')}>
                      تغییر به مدیر
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleRoleChange(user.id, 'ACCOUNTANT')}>
                      تغییر به حسابدار
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleRoleChange(user.id, 'SALES')}>
                      تغییر به فروشنده
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleRoleChange(user.id, 'WAREHOUSE')}>
                      تغییر به انباردار
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleDelete(user.id)}
                      className="text-red-600"
                    >
                      <Trash className="mr-2 h-4 w-4" />
                      حذف کاربر
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
