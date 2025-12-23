'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { changePassword } from '@/actions/user';
import { toast } from 'sonner';

export function PasswordForm() {
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (formData: FormData) => {
    const newPass = formData.get('newPassword') as string;
    const confirmPass = formData.get('confirmPassword') as string;

    if (newPass !== confirmPass) {
      toast.error('رمز عبور جدید و تکرار آن مطابقت ندارند.');
      return;
    }

    setLoading(true);
    const result = await changePassword(null, formData);
    setLoading(false);

    if (result.success) {
      toast.success(result.message);
      // Reset form
      const form = document.getElementById('password-form') as HTMLFormElement;
      form.reset();
    } else {
      toast.error(result.message);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>تغییر رمز عبور</CardTitle>
        <CardDescription>
          برای امنیت بیشتر، رمز عبور خود را دوره‌ای تغییر دهید.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id="password-form" action={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">رمز عبور فعلی</Label>
              <Input 
                id="currentPassword" 
                name="currentPassword" 
                type="password" 
                required 
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">رمز عبور جدید</Label>
              <Input 
                id="newPassword" 
                name="newPassword" 
                type="password" 
                required 
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">تکرار رمز عبور جدید</Label>
              <Input 
                id="confirmPassword" 
                name="confirmPassword" 
                type="password" 
                required 
                minLength={6}
              />
            </div>
          </div>
          <Button type="submit" variant="secondary" disabled={loading}>
            {loading ? 'در حال تغییر...' : 'تغییر رمز عبور'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
