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
import { ROLES, ROLE_LABELS, describeRole } from '@/lib/permissions';
import { useRouter } from 'next/navigation';

interface UserFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: any; // User type
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
        Object.values(result.errors).forEach((error: any) => {
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
        <form action={handleSubmit} className="grid gap-3 py-2" onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          handleSubmit(formData);
        }}>
          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-[12.5px] font-normal text-muted-foreground">
              نام
            </Label>
            <Input
              id="name"
              name="name"
              defaultValue={user?.name}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-[12.5px] font-normal text-muted-foreground">
              ایمیل
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              dir="ltr"
              defaultValue={user?.email}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone" className="text-[12.5px] font-normal text-muted-foreground">
              موبایل
            </Label>
            <Input
              id="phone"
              name="phone"
              dir="ltr"
              defaultValue={user?.phone}
              placeholder="0912..."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role" className="text-[12.5px] font-normal text-muted-foreground">
              نقش
            </Label>
            <Select 
              name="role" 
              value={role} 
              onValueChange={(value) => {
                setRole(value as Role);
              }}
            >
              <SelectTrigger id="role">
                <SelectValue placeholder="انتخاب نقش" />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((value) => (
                  <SelectItem key={value} value={value}>{ROLE_LABELS[value]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="role" value={role} />
            <div className="space-y-0.5 rounded-md bg-secondary px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {describeRole(role).map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </div>
          
          {!isEditing && (
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-[12.5px] font-normal text-muted-foreground">
                رمز عبور
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                dir="ltr"
                autoComplete="new-password"
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
