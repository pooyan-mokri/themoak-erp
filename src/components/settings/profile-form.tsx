'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { updateProfile } from '@/actions/user';
import { toast } from 'sonner';
import { useSession } from 'next-auth/react';
import { FieldRow, PanelActions, SettingsPanel } from './settings-panel';

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
    <SettingsPanel title="اطلاعات شخصی" description="اطلاعات حساب کاربری خود را ویرایش کنید.">
      <form action={handleSubmit}>
        <FieldRow label="نام و نام خانوادگی" htmlFor="name">
          <Input
            id="name"
            name="name"
            defaultValue={session?.user?.name || ''}
            required
          />
        </FieldRow>
        <FieldRow label="ایمیل" htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            dir="ltr"
            defaultValue={session?.user?.email || ''}
            required
          />
        </FieldRow>
        <FieldRow label="شماره موبایل" htmlFor="phone">
          <Input
            id="phone"
            name="phone"
            dir="ltr"
            // @ts-ignore - phone might not be in session type yet until next-auth types are updated
            defaultValue={session?.user?.phone || ''}
            placeholder="0912..."
          />
        </FieldRow>
        <PanelActions>
          <Button type="submit" disabled={loading}>
            {loading ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
          </Button>
        </PanelActions>
      </form>
    </SettingsPanel>
  );
}
