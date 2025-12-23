'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { updateProfile } from '@/actions/user';
import { toast } from 'sonner';
import { useSession } from 'next-auth/react';

export function ProfileForm() {
  const { data: session, update } = useSession();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (formData: FormData) => {
    setLoading(true);
    const result = await updateProfile(null, formData);
    setLoading(false);

    if (result.success) {
      toast.success(result.message);
      // Update session to reflect changes immediately
      await update({
        ...session,
        user: {
          ...session?.user,
          name: formData.get('name') as string,
          email: formData.get('email') as string,
        }
      });
    } else {
      toast.error(result.message);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>اطلاعات شخصی</CardTitle>
        <CardDescription>
          اطلاعات حساب کاربری خود را ویرایش کنید.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">نام و نام خانوادگی</Label>
              <Input 
                id="name" 
                name="name" 
                defaultValue={session?.user?.name || ''} 
                required 
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">ایمیل</Label>
              <Input 
                id="email" 
                name="email" 
                type="email" 
                defaultValue={session?.user?.email || ''} 
                required 
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">شماره موبایل</Label>
              <Input 
                id="phone" 
                name="phone" 
                // @ts-ignore - phone might not be in session type yet until next-auth types are updated
                defaultValue={session?.user?.phone || ''} 
                placeholder="0912..."
              />
            </div>
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
