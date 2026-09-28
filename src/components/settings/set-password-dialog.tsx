'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { setUserPassword } from '@/actions/user';
import { toast } from 'sonner';

interface SetPasswordDialogProps {
  user?: { id: string; name: string };
  onOpenChange: (open: boolean) => void;
}

/** An admin sets another user's password (src/actions/user.ts). */
export function SetPasswordDialog({ user, onOpenChange }: SetPasswordDialogProps) {
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    const result: any = await setUserPassword(user.id, null, new FormData(e.currentTarget));
    setLoading(false);
    if (result.success) {
      toast.success(result.message);
      onOpenChange(false);
    } else if (result.errors) {
      Object.values(result.errors).flat().forEach((msg) => toast.error(String(msg)));
    } else {
      toast.error(result.message);
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>تغییر رمز عبور {user?.name}</DialogTitle>
          <DialogDescription>ورود فعلی این کاربر روی همهٔ دستگاه‌ها پایان می‌یابد و باید با رمز تازه وارد شود.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="set-new-password">رمز عبور جدید</Label>
            <Input id="set-new-password" name="newPassword" type="password" minLength={6} required autoComplete="new-password" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="set-confirm-password">تکرار رمز عبور جدید</Label>
            <Input id="set-confirm-password" name="confirmPassword" type="password" minLength={6} required autoComplete="new-password" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? 'در حال ذخیره...' : 'تغییر رمز'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
