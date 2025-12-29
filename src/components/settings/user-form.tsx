'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createUser, updateUser } from '@/actions/user';
import { toast } from 'sonner';
import { Role } from '@/lib/types';
import { useRouter } from 'next/navigation';

interface User {
  id: string;
  name: string | null;
  email: string;
  role: Role;
}

interface UserFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: User;
}

export function UserForm({ open, onOpenChange, user }: UserFormProps) {
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState<Role>(user?.role || Role.USER);
  const router = useRouter();
  const isEditing = !!user;

  useEffect(() => {
    if (user) {
      setRole(user.role || Role.USER);
    } else {
      setRole(Role.USER);
    }
  }, [user, open]);

  const handleSubmit = async (formData: FormData) => {
    setLoading(true);
    
    // Add role to formData if not present
    if (!formData.get('role')) {
      formData.append('role', role);
    }
    
    let result;
    
    if (isEditing) {
      result = await updateUser(user.id, null, formData);
    } else {
      result = await createUser(null, formData);
    }
    
    setLoading(false);

    if (result.success) {
      toast.success(result.message);
      onOpenChange(false);
      router.refresh(); // Refresh the page to show updated user list
    } else {
      if (result.errors) {
        Object.values(result.errors).forEach((error) => {
          if (Array.isArray(error)) {
            error.forEach((msg) => toast.error(msg));
          } else {
            toast.error(error);
          }
        });
      } else {
        toast.error(result.message || 'خطا در ذخیره اطلاعات');
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'ویرایش کاربر' : 'افزودن کاربر جدید'}</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="grid gap-4 py-4" onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          handleSubmit(formData);
        }}>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">
              نام
            </Label>
            <Input
              id="name"
              name="name"
              defaultValue={user?.name}
              className="col-span-3"
              required
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="email" className="text-right">
              ایمیل
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={user?.email}
              className="col-span-3"
              required
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="phone" className="text-right">
              موبایل
            </Label>
            <Input
              id="phone"
              name="phone"
              defaultValue={user?.phone}
              className="col-span-3"
              placeholder="0912..."
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="role" className="text-right">
              نقش
            </Label>
            <div className="col-span-3">
              <Select 
                name="role" 
                value={role} 
                onValueChange={(value) => {
                  setRole(value as Role);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب نقش" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={Role.ADMIN}>مدیر سیستم</SelectItem>
                  <SelectItem value={Role.ACCOUNTANT}>حسابدار</SelectItem>
                  <SelectItem value={Role.SALES}>فروشنده</SelectItem>
                  <SelectItem value={Role.WAREHOUSE}>انباردار</SelectItem>
                  <SelectItem value={Role.PROJECT_MANAGER}>مدیر پروژه</SelectItem>
                  <SelectItem value={Role.USER}>کاربر عادی</SelectItem>
                </SelectContent>
              </Select>
              <input type="hidden" name="role" value={role} />
            </div>
          </div>
          
          {!isEditing && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="password" className="text-right">
                رمز عبور
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                className="col-span-3"
                required
                minLength={6}
              />
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? 'در حال ذخیره...' : 'ذخیره'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
